import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, getCarekeeperVehicleIds, isOnlyCarkeeper } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import { listRentals, getRental, updateRental, getRentalStats } from './rentals.service';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const filtersSchema = z.object({
  vehicleId: z.string().optional(),
  status: z.enum(['booked', 'active', 'completed', 'cancelled']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

const cancelSchema = z.object({
  cancellationReason: z.enum(['annulation_locataire', 'annulation_proprio', 'no_show', 'litige', 'sans_suite']).optional(),
});

const updateSchema = z.object({
  startMileage: z.number().int().min(0).optional(),
  endMileage: z.number().int().min(0).optional(),
  status: z.enum(['booked', 'active', 'completed', 'cancelled']).optional(),
  evaluationStatus: z.enum(['pending', 'posted', 'blocked']).optional(),
  evaluationRating: z.number().int().min(1).max(5).optional(),
  evaluationComment: z.string().optional(),
  grossRevenue: z.number().min(0).optional(),
  ownerPayout: z.number().min(0).optional(),
  driverMessFee: z.number().min(0).optional(),
  damageCompensation: z.number().min(0).optional(),
  gasRefillFee: z.number().min(0).optional(),
  lateReturnFee: z.number().min(0).optional(),
});

// GET /api/v1/rentals
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = filtersSchema.safeParse(req.query);
    if (!q.success) { res.status(400).json({ error: 'Paramètres invalides', details: q.error.flatten() }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const vehicleIds = isOnlyCarkeeper(req.auth) && req.auth?.userId
      ? await getCarekeeperVehicleIds(db, req.auth.userId)
      : undefined;

    const result = await listRentals(db, {
      ...q.data,
      ...(vehicleIds ? { vehicleIds } : {}),
      from: q.data.from ? new Date(q.data.from) : undefined,
      to: q.data.to ? new Date(q.data.to) : undefined,
    });
    res.json(result);
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/rentals/stats
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const from = req.query.from ? new Date(req.query.from as string) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to   = req.query.to   ? new Date(req.query.to   as string) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const stats = await getRentalStats(db, from, to);
    res.json({ stats, period: { from, to } });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/rentals/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const rental = await getRental(db, (req.params.id as string));
    if (!rental) { res.status(404).json({ error: 'Location introuvable' }); return; }
    res.json({ rental });
  } catch (err: unknown) { next(err); }
});

// PATCH /api/v1/rentals/:id/cancel
router.patch('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = cancelSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const existing = await db.rental.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, status: true, ownerPayout: true },
    });
    if (!existing) { res.status(404).json({ error: 'Location introuvable' }); return; }
    if (existing.ownerPayout != null) {
      res.status(400).json({ error: 'Impossible d\'annuler une location déjà payée' }); return;
    }
    const rental = await db.rental.update({
      where: { id: req.params.id as string },
      data: { status: 'cancelled', cancellationReason: body.data.cancellationReason ?? null },
    });
    res.json({ rental });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/rentals/:id/invoices
router.get('/:id/invoices', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const invoices = await db.rentalInvoice.findMany({
      where: { rentalId: req.params.id as string },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ invoices });
  } catch (err: unknown) { next(err); }
});

// PATCH /api/v1/rentals/:id/unblock-evaluation
router.patch('/:id/unblock-evaluation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const existing = await db.rental.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, evaluationFlag: true },
    });
    if (!existing) { res.status(404).json({ error: 'Location introuvable' }); return; }
    if (!existing.evaluationFlag) { res.status(400).json({ error: 'Aucun flag à débloquer' }); return; }
    const rental = await db.rental.update({
      where: { id: req.params.id as string },
      data: { evaluationFlagUnblockedAt: new Date(), evaluationFlagUnblockedById: req.auth?.userId ?? null },
    });
    res.json({ rental });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/rentals/flagged — locations avec evaluationFlag actif non débloqué
router.get('/flagged', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const rentals = await db.rental.findMany({
      where: { evaluationFlag: { not: null }, evaluationFlagUnblockedAt: null },
      include: { vehicle: { select: { make: true, model: true, licensePlate: true } } },
      orderBy: { startAt: 'desc' },
      take: 100,
    });
    res.json({ rentals });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/rentals/:id/risk-score — score risque locataire (0=faible, 100=élevé)
router.get('/:id/risk-score', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const [rental, settings] = await Promise.all([
      db.rental.findUnique({
        where: { id: req.params.id as string },
        select: { driverGetaroundId: true, driverName: true },
      }),
      db.companySettings.findFirst({
        select: { riskWeightScore: true, riskWeightFlags: true, riskWeightCancelled: true, riskWeightDelay: true, riskScoreAlertThreshold: true },
      }),
    ]);

    if (!rental) { res.status(404).json({ error: 'Location introuvable' }); return; }

    const wScore = settings?.riskWeightScore ?? 40;
    const wFlags = settings?.riskWeightFlags ?? 30;
    const wCancelled = settings?.riskWeightCancelled ?? 20;
    const wDelay = settings?.riskWeightDelay ?? 10;
    const alertThreshold = settings?.riskScoreAlertThreshold ?? 60;

    const prevRentals = rental.driverGetaroundId
      ? await db.rental.findMany({
          where: { driverGetaroundId: rental.driverGetaroundId },
          select: { evaluationRating: true, damageCompensation: true, lateReturnFee: true, driverMessFee: true, gasRefillFee: true, evaluationFlag: true, status: true },
        })
      : [];

    // Calcul driver score (même logique que scoring.routes)
    let driverScore = 100;
    if (prevRentals.length > 0) {
      const rated = prevRentals.filter(r => r.evaluationRating !== null);
      if (rated.length > 0) {
        const avg = rated.reduce((s, r) => s + (r.evaluationRating ?? 0), 0) / rated.length;
        driverScore += (avg - 4.0) * 10;
      }
      driverScore -= prevRentals.filter(r => (r.damageCompensation ?? 0) > 0).length * 12;
      driverScore -= prevRentals.filter(r => (r.lateReturnFee ?? 0) > 0).length * 5;
      driverScore -= prevRentals.filter(r => (r.driverMessFee ?? 0) > 0).length * 8;
      driverScore -= prevRentals.filter(r => (r.gasRefillFee ?? 0) > 0).length * 3;
      driverScore = Math.min(100, Math.max(0, Math.round(driverScore)));
    }

    const flagCount = prevRentals.filter(r => r.evaluationFlag != null).length;
    const cancelledCount = prevRentals.filter(r => r.status === 'cancelled').length;

    const driverRisk = 100 - driverScore; // 0=bon conducteur, 100=mauvais
    const flagRisk = Math.min(flagCount * 25, 100);
    const cancelledRisk = Math.min(cancelledCount * 20, 100);
    const delayRisk = 50; // valeur neutre (données non disponibles)

    const riskScore = Math.round(
      (driverRisk * wScore + flagRisk * wFlags + cancelledRisk * wCancelled + delayRisk * wDelay) / 100
    );

    const level = riskScore >= 75 ? 'high' : riskScore >= 50 ? 'medium' : 'low';

    res.json({
      riskScore: Math.min(100, riskScore),
      level,
      isAlert: riskScore >= alertThreshold,
      driverScore,
      flagCount,
      cancelledCount,
      totalRentals: prevRentals.length,
      weights: { wScore, wFlags, wCancelled, wDelay },
    });
  } catch (err) { next(err); }
});

// PUT /api/v1/rentals/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const rental = await updateRental(db, (req.params.id as string), body.data);
    res.json({ rental });
  } catch (err: unknown) { next(err); }
});

export default router;
