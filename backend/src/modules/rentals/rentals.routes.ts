import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
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
  limit: z.coerce.number().int().min(1).max(200).optional(),
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
    const result = await listRentals(db, {
      ...q.data,
      from: q.data.from ? new Date(q.data.from) : undefined,
      to: q.data.to ? new Date(q.data.to) : undefined,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/v1/rentals/stats
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1); // 1er du mois courant
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); // dernier jour
    const stats = await getRentalStats(db, from, to);
    res.json({ stats, period: { from, to } });
  } catch (err) { next(err); }
});

// GET /api/v1/rentals/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const rental = await getRental(db, (req.params.id as string));
    if (!rental) { res.status(404).json({ error: 'Location introuvable' }); return; }
    res.json({ rental });
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
  } catch (err) { next(err); }
});

export default router;
