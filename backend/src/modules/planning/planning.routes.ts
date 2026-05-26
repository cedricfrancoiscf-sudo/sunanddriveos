import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, getCarekeeperVehicleIds } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const blockingSchema = z.object({
  vehicleId: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  reason: z.string().optional(),
  type: z.enum(['maintenance', 'incident', 'administrative', 'other']),
});

// GET /api/v1/planning — retourne locations + blocages pour une période
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : new Date();
    const to = req.query.to
      ? new Date(req.query.to as string)
      : new Date(from.getTime() + 30 * 86_400_000);

    const db = getTenantClient(req.tenantDbUrl!);
    const vehicleIds = req.auth?.role === 'carkeeper' && req.auth.userId
      ? await getCarekeeperVehicleIds(db, req.auth.userId)
      : undefined;

    const vehicleFilter = vehicleIds ? { id: { in: vehicleIds } } : { isActive: true };
    const rentalVehicleFilter = vehicleIds ? { vehicleId: { in: vehicleIds } } : {};
    const blockingVehicleFilter = vehicleIds ? { vehicleId: { in: vehicleIds } } : {};

    const [rentals, blockings, vehicles] = await Promise.all([
      db.rental.findMany({
        where: { startAt: { lte: to }, endAt: { gte: from }, status: { in: ['booked', 'active', 'completed'] }, ...rentalVehicleFilter },
        select: {
          id: true, vehicleId: true, driverName: true, startAt: true, endAt: true, status: true,
          _count: { select: { carSeatRequests: true, accessoryReservations: true } },
        },
      }),
      db.blocking.findMany({
        where: { startAt: { lte: to }, endAt: { gte: from }, ...blockingVehicleFilter },
        select: { id: true, vehicleId: true, reason: true, type: true, startAt: true, endAt: true },
      }),
      db.vehicle.findMany({
        where: vehicleFilter,
        select: { id: true, make: true, model: true, licensePlate: true, photoUrl: true, parkingZone: true },
        orderBy: [{ parkingZone: 'asc' }, { make: 'asc' }],
      }),
    ]);

    res.json({ rentals, blockings, vehicles, period: { from, to } });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/planning/blockings — créer un blocage
router.post('/blockings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = blockingSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const blocking = await db.blocking.create({
      data: {
        ...body.data,
        startAt: new Date(body.data.startAt),
        endAt: new Date(body.data.endAt),
        createdById: req.auth!.userId!,
      },
    });
    res.status(201).json({ blocking });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/planning/blockings/:id
router.delete('/blockings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await db.blocking.delete({ where: { id: (req.params.id as string) } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
