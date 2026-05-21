import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const BLOCKING_TYPES = ['maintenance', 'incident', 'administrative', 'other'] as const;

const createSchema = z.object({
  vehicleId: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  reason: z.string().optional(),
  type: z.enum(BLOCKING_TYPES).default('other'),
});

const updateSchema = z.object({
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  reason: z.string().nullable().optional(),
  type: z.enum(BLOCKING_TYPES).optional(),
});

// GET /api/v1/blockings?vehicleId=&from=&to=
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);

    const whereDate = req.query.from || req.query.to
      ? {
          AND: [
            ...(req.query.from ? [{ endAt: { gte: new Date(req.query.from as string) } }] : []),
            ...(req.query.to ? [{ startAt: { lte: new Date(req.query.to as string) } }] : []),
          ],
        }
      : {};

    const blockings = await db.blocking.findMany({
      where: {
        ...(req.query.vehicleId ? { vehicleId: req.query.vehicleId as string } : {}),
        ...whereDate,
      },
      include: {
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
      },
      orderBy: { startAt: 'asc' },
    });

    res.json({ blockings });
  } catch (err) { next(err); }
});

// GET /api/v1/blockings/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const blocking = await db.blocking.findUnique({
      where: { id: (req.params.id as string) },
      include: {
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
      },
    });
    if (!blocking) { res.status(404).json({ error: 'Blocage introuvable' }); return; }
    res.json({ blocking });
  } catch (err) { next(err); }
});

// POST /api/v1/blockings
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const { startAt, endAt } = body.data;
    if (new Date(endAt) <= new Date(startAt)) {
      res.status(400).json({ error: 'La date de fin doit être postérieure à la date de début' });
      return;
    }

    const db = getTenantClient(req.tenantDbUrl!);
    const blocking = await db.blocking.create({
      data: {
        vehicleId: body.data.vehicleId,
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        reason: body.data.reason,
        type: body.data.type,
        createdById: req.auth!.userId!,
      },
      include: {
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
      },
    });

    res.status(201).json({ blocking });
  } catch (err) { next(err); }
});

// PUT /api/v1/blockings/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const existing = await db.blocking.findUnique({ where: { id: (req.params.id as string) } });
    if (!existing) { res.status(404).json({ error: 'Blocage introuvable' }); return; }

    const startAt = body.data.startAt ? new Date(body.data.startAt) : existing.startAt;
    const endAt = body.data.endAt ? new Date(body.data.endAt) : existing.endAt;
    if (endAt <= startAt) {
      res.status(400).json({ error: 'La date de fin doit être postérieure à la date de début' });
      return;
    }

    const blocking = await db.blocking.update({
      where: { id: (req.params.id as string) },
      data: {
        ...(body.data.startAt ? { startAt: new Date(body.data.startAt) } : {}),
        ...(body.data.endAt ? { endAt: new Date(body.data.endAt) } : {}),
        ...(body.data.reason !== undefined ? { reason: body.data.reason } : {}),
        ...(body.data.type ? { type: body.data.type } : {}),
      },
      include: {
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
      },
    });

    res.json({ blocking });
  } catch (err) { next(err); }
});

// DELETE /api/v1/blockings/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const existing = await db.blocking.findUnique({ where: { id: (req.params.id as string) } });
    if (!existing) { res.status(404).json({ error: 'Blocage introuvable' }); return; }
    await db.blocking.delete({ where: { id: (req.params.id as string) } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
