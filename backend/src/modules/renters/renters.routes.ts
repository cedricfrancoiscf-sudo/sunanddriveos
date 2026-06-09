import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

function computeScore(rentals: Array<{
  evaluationRating: number | null;
  damageCompensation: number | null;
  lateReturnFee: number | null;
  driverMessFee: number | null;
  gasRefillFee: number | null;
}>): number {
  if (rentals.length === 0) return 100;
  let score = 100;
  const rated = rentals.filter(r => r.evaluationRating !== null);
  if (rated.length > 0) {
    const avg = rated.reduce((s, r) => s + (r.evaluationRating ?? 0), 0) / rated.length;
    score += (avg - 4.0) * 10;
  }
  const withDamage = rentals.filter(r => (r.damageCompensation ?? 0) > 0).length;
  if (withDamage > 0) score -= withDamage * 12;
  const withLate = rentals.filter(r => (r.lateReturnFee ?? 0) > 0).length;
  if (withLate > 0) score -= withLate * 5;
  const withMess = rentals.filter(r => (r.driverMessFee ?? 0) > 0).length;
  if (withMess > 0) score -= withMess * 8;
  const withGas = rentals.filter(r => (r.gasRefillFee ?? 0) > 0).length;
  if (withGas > 0) score -= withGas * 3;
  if (rentals.length > 5) score += Math.min((rentals.length - 5) * 0.5, 10);
  return Math.min(100, Math.max(0, Math.round(score)));
}

function scoreTier(score: number): 'excellent' | 'good' | 'average' | 'poor' {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 50) return 'average';
  return 'poor';
}

// GET /api/v1/renters
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);

    const [rentals, blacklist] = await Promise.all([
      db.rental.findMany({
        where: { status: { in: ['completed', 'active', 'booked'] }, driverGetaroundId: { not: null } },
        select: {
          driverGetaroundId: true,
          driverName: true,
          ownerPayout: true,
          grossRevenue: true,
          kmDriven: true,
          endAt: true,
          evaluationRating: true,
          damageCompensation: true,
          lateReturnFee: true,
          driverMessFee: true,
          gasRefillFee: true,
        },
        orderBy: { endAt: 'desc' },
      }),
      db.renterBlacklist.findMany({ select: { driverGetaroundId: true } }),
    ]);

    const blacklistedIds = new Set(blacklist.map(b => b.driverGetaroundId));

    type RenterRaw = {
      name: string;
      rentalCount: number;
      ca: number;
      km: number;
      lastRentalAt: Date;
      ratingSum: number;
      ratingCount: number;
      rentalsForScore: Array<{
        evaluationRating: number | null;
        damageCompensation: number | null;
        lateReturnFee: number | null;
        driverMessFee: number | null;
        gasRefillFee: number | null;
      }>;
    };

    const map = new Map<string, RenterRaw>();

    for (const r of rentals) {
      const id = r.driverGetaroundId!;
      const ca = (r.ownerPayout ?? 0) > 0 ? (r.ownerPayout ?? 0) : Math.max(0, r.grossRevenue ?? 0);
      const scoreEntry = {
        evaluationRating: r.evaluationRating,
        damageCompensation: r.damageCompensation,
        lateReturnFee: r.lateReturnFee,
        driverMessFee: r.driverMessFee,
        gasRefillFee: r.gasRefillFee,
      };
      const existing = map.get(id);
      if (!existing) {
        map.set(id, {
          name: r.driverName,
          rentalCount: 1,
          ca,
          km: r.kmDriven ?? 0,
          lastRentalAt: new Date(r.endAt),
          ratingSum: r.evaluationRating ?? 0,
          ratingCount: r.evaluationRating ? 1 : 0,
          rentalsForScore: [scoreEntry],
        });
      } else {
        existing.rentalCount++;
        existing.ca += ca;
        existing.km += r.kmDriven ?? 0;
        if (new Date(r.endAt) > existing.lastRentalAt) existing.lastRentalAt = new Date(r.endAt);
        if (r.evaluationRating) { existing.ratingSum += r.evaluationRating; existing.ratingCount++; }
        existing.rentalsForScore.push(scoreEntry);
      }
    }

    const renters = Array.from(map.entries())
      .map(([id, d]) => {
        const score = computeScore(d.rentalsForScore);
        return {
          driverGetaroundId: id,
          name: d.name,
          rentalCount: d.rentalCount,
          totalCA: Math.round(d.ca * 100) / 100,
          totalKm: d.km,
          lastRentalAt: d.lastRentalAt,
          avgRating: d.ratingCount > 0 ? Math.round((d.ratingSum / d.ratingCount) * 10) / 10 : null,
          isBlacklisted: blacklistedIds.has(id),
          isVip: d.rentalCount >= 5 && !blacklistedIds.has(id),
          score,
          tier: scoreTier(score),
        };
      })
      .sort((a, b) => b.totalCA - a.totalCA);

    res.json({ renters, total: renters.length });
  } catch (err) { next(err); }
});

export default router;
