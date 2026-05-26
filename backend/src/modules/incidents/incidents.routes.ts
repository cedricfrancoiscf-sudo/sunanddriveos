import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const INCIDENT_TYPES = ['damage', 'theft', 'accident', 'vandalism', 'other'] as const;
const INCIDENT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;

// GET /api/v1/incidents?vehicleId=&rentalId=&status=
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const incidents = await db.incident.findMany({
      where: {
        ...(req.query.vehicleId ? { vehicleId: req.query.vehicleId as string } : {}),
        ...(req.query.rentalId ? { rentalId: req.query.rentalId as string } : {}),
        ...(req.query.status ? { status: req.query.status as string } : {}),
      } as never,
      include: {
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
        rental: { select: { id: true, driverName: true, startAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ incidents });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/incidents — créer un incident
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      vehicleId: z.string().min(1),
      rentalId: z.string().optional(),
      type: z.enum(INCIDENT_TYPES),
      description: z.string().min(1),
      cost: z.number().optional(),
      insuranceReference: z.string().optional(),
      photos: z.array(z.string()).default([]),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const incident = await db.incident.create({ data: body.data });
    res.status(201).json({ incident });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/incidents/:id — mettre à jour un incident
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      type: z.enum(INCIDENT_TYPES).optional(),
      description: z.string().optional(),
      status: z.enum(INCIDENT_STATUSES).optional(),
      cost: z.number().nullable().optional(),
      insuranceReference: z.string().nullable().optional(),
      resolution: z.string().nullable().optional(),
      resolvedAt: z.string().datetime().nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);

    const updateData: Record<string, unknown> = { ...body.data };
    if (body.data.status === 'resolved' && !body.data.resolvedAt) {
      updateData.resolvedAt = new Date().toISOString();
    }

    const incident = await db.incident.update({ where: { id: (req.params.id as string) }, data: updateData as never });
    res.json({ incident });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/incidents/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await db.incident.delete({ where: { id: (req.params.id as string) } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
