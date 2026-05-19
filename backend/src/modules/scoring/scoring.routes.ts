import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router = Router();
router.use(requireAuth, resolveTenant);

// Calcul du score d'un conducteur à partir de ses locations complétées
function computeDriverScore(rentals: Array<{
  evaluationRating: number | null;
  damageCompensation: number | null;
  lateReturnFee: number | null;
  driverMessFee: number | null;
  gasRefillFee: number | null;
}>): { score: number; breakdown: Record<string, number> } {
  if (rentals.length === 0) return { score: 100, breakdown: {} };

  let score = 100;
  const breakdown: Record<string, number> = {};

  // Moyenne des notes Getaround (pondération forte)
  const rated = rentals.filter(r => r.evaluationRating !== null);
  if (rated.length > 0) {
    const avg = rated.reduce((s, r) => s + (r.evaluationRating ?? 0), 0) / rated.length;
    const ratingDelta = (avg - 4.0) * 10; // 5★ → +10, 4★ → 0, 3★ → -10, etc.
    score += ratingDelta;
    breakdown.rating = Math.round(ratingDelta * 10) / 10;
  }

  // Dommages : -12 par location avec dommages
  const withDamage = rentals.filter(r => (r.damageCompensation ?? 0) > 0).length;
  if (withDamage > 0) {
    const delta = -(withDamage * 12);
    score += delta;
    breakdown.damage = delta;
  }

  // Retards : -5 par location avec frais retard
  const withLate = rentals.filter(r => (r.lateReturnFee ?? 0) > 0).length;
  if (withLate > 0) {
    const delta = -(withLate * 5);
    score += delta;
    breakdown.lateReturn = delta;
  }

  // Frais messagerie (contentieux) : -8 par occurrence
  const withMess = rentals.filter(r => (r.driverMessFee ?? 0) > 0).length;
  if (withMess > 0) {
    const delta = -(withMess * 8);
    score += delta;
    breakdown.messFee = delta;
  }

  // Frais carburant : -3 par occurrence
  const withGas = rentals.filter(r => (r.gasRefillFee ?? 0) > 0).length;
  if (withGas > 0) {
    const delta = -(withGas * 3);
    score += delta;
    breakdown.gasFee = delta;
  }

  // Bonus fidélité : +0.5 par location au-delà de 5 (plafonné à +10)
  if (rentals.length > 5) {
    const delta = Math.min((rentals.length - 5) * 0.5, 10);
    score += delta;
    breakdown.loyalty = Math.round(delta * 10) / 10;
  }

  return { score: Math.min(100, Math.max(0, Math.round(score))), breakdown };
}

export function scoreTier(score: number): 'excellent' | 'good' | 'average' | 'poor' {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 50) return 'average';
  return 'poor';
}

// GET /api/v1/scoring/drivers?tier=excellent|good|average|poor&search=&page=1&limit=50
router.get('/drivers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const search = (req.query.search as string | undefined)?.toLowerCase();
    const tierFilter = req.query.tier as string | undefined;

    // Récupère toutes les locations complétées groupées par conducteur
    const rentals = await db.rental.findMany({
      where: { status: 'completed' },
      select: {
        id: true,
        driverName: true,
        driverEmail: true,
        driverGetaroundId: true,
        startAt: true,
        endAt: true,
        vehicleId: true,
        evaluationRating: true,
        damageCompensation: true,
        lateReturnFee: true,
        driverMessFee: true,
        gasRefillFee: true,
        grossRevenue: true,
        vehicle: { select: { make: true, model: true, licensePlate: true } },
      },
      orderBy: { endAt: 'desc' },
    });

    // Regroupe par conducteur (email prioritaire, sinon getaroundId, sinon nom)
    const driverMap = new Map<string, {
      key: string;
      name: string;
      email: string | null;
      getaroundId: string | null;
      rentals: typeof rentals;
      lastRentalAt: Date;
      totalRevenue: number;
    }>();

    for (const r of rentals) {
      const key = r.driverEmail ?? r.driverGetaroundId ?? r.driverName;
      const existing = driverMap.get(key);
      if (existing) {
        existing.rentals.push(r);
        existing.totalRevenue += r.grossRevenue ?? 0;
        if (new Date(r.endAt) > existing.lastRentalAt) {
          existing.lastRentalAt = new Date(r.endAt);
        }
      } else {
        driverMap.set(key, {
          key,
          name: r.driverName,
          email: r.driverEmail,
          getaroundId: r.driverGetaroundId,
          rentals: [r],
          lastRentalAt: new Date(r.endAt),
          totalRevenue: r.grossRevenue ?? 0,
        });
      }
    }

    // Construit la liste scorée
    let drivers = Array.from(driverMap.values()).map(d => {
      const { score, breakdown } = computeDriverScore(d.rentals);
      return {
        key: d.key,
        name: d.name,
        email: d.email,
        getaroundId: d.getaroundId,
        rentalCount: d.rentals.length,
        lastRentalAt: d.lastRentalAt.toISOString(),
        totalRevenue: Math.round(d.totalRevenue * 100) / 100,
        score,
        tier: scoreTier(score),
        breakdown,
      };
    });

    // Filtres
    if (search) {
      drivers = drivers.filter(d =>
        d.name.toLowerCase().includes(search) ||
        (d.email ?? '').toLowerCase().includes(search)
      );
    }
    if (tierFilter) {
      drivers = drivers.filter(d => d.tier === tierFilter);
    }

    // Tri par score desc
    drivers.sort((a, b) => b.score - a.score);

    const total = drivers.length;
    const paginated = drivers.slice((page - 1) * limit, page * limit);

    // Stats globales
    const stats = {
      total,
      excellent: drivers.filter(d => d.tier === 'excellent').length,
      good: drivers.filter(d => d.tier === 'good').length,
      average: drivers.filter(d => d.tier === 'average').length,
      poor: drivers.filter(d => d.tier === 'poor').length,
      avgScore: drivers.length > 0
        ? Math.round(drivers.reduce((s, d) => s + d.score, 0) / drivers.length)
        : 0,
    };

    res.json({ drivers: paginated, stats, total, page, limit });
  } catch (err) { next(err); }
});

// GET /api/v1/scoring/drivers/:driverKey — détail conducteur (encode email ou name)
router.get('/drivers/:driverKey', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const driverKey = decodeURIComponent((req.params.driverKey as string));

    const rentals = await db.rental.findMany({
      where: {
        status: 'completed',
        OR: [
          { driverEmail: driverKey },
          { driverGetaroundId: driverKey },
          { driverName: driverKey },
        ],
      },
      select: {
        id: true,
        driverName: true,
        driverEmail: true,
        startAt: true,
        endAt: true,
        evaluationRating: true,
        evaluationComment: true,
        evaluationStatus: true,
        damageCompensation: true,
        lateReturnFee: true,
        driverMessFee: true,
        gasRefillFee: true,
        grossRevenue: true,
        kmDriven: true,
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
        incidents: { select: { id: true, type: true, status: true, cost: true } },
      },
      orderBy: { endAt: 'desc' },
    });

    if (rentals.length === 0) {
      res.status(404).json({ error: 'Conducteur introuvable' });
      return;
    }

    const { score, breakdown } = computeDriverScore(rentals);

    res.json({
      driver: {
        key: driverKey,
        name: rentals[0].driverName,
        email: rentals[0].driverEmail,
        rentalCount: rentals.length,
        lastRentalAt: rentals[0].endAt,
        totalRevenue: Math.round(rentals.reduce((s, r) => s + (r.grossRevenue ?? 0), 0) * 100) / 100,
        totalKm: rentals.reduce((s, r) => s + (r.kmDriven ?? 0), 0),
        score,
        tier: scoreTier(score),
        breakdown,
      },
      rentals,
    });
  } catch (err) { next(err); }
});

export default router;
