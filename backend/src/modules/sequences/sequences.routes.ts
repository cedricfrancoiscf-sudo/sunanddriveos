import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import {
  listSequences,
  createSequence,
  updateSequence,
  deleteSequence,
  toggleSequence,
  executePendingSequences,
} from './sequences.service';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const sequenceSchema = z.object({
  name: z.string().min(1),
  triggerEvent: z.enum(['rental.booked', 'rental.car_checked_in', 'rental.car_checked_out', 'rental.before_checkin', 'rental.before_checkout']),
  delayMinutes: z.number().int().min(1),
  content: z.string().min(1),
  vehicleId: z.string().optional(),
});

// GET /api/v1/sequences
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const sequences = await listSequences(db);
    res.json({ sequences });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/sequences
router.post('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = sequenceSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const sequence = await createSequence(db, body.data);
    res.status(201).json({ sequence });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/sequences/:id
router.put('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = sequenceSchema.partial().extend({ isActive: z.boolean().optional() }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const sequence = await updateSequence(db, (req.params.id as string), body.data);
    res.json({ sequence });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/sequences/:id/toggle
router.post('/:id/toggle', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const sequence = await toggleSequence(db, (req.params.id as string));
    res.json({ sequence });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/sequences/:id
router.delete('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await deleteSequence(db, (req.params.id as string));
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/sequences/execute-pending — appelé par le cron interne
router.post('/execute-pending', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const result = await executePendingSequences(db);
    res.json(result);
  } catch (err: unknown) { next(err); }
});

export default router;
