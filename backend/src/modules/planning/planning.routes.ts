import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, getCarekeeperVehicleIds } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import { decrypt } from '../../utils/crypto';
import { createGetaroundClient } from '../getaround-sync/getaround-api';

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
    const rawStart = (req.query.startDate ?? req.query.from) as string | undefined;
    const rawEnd = (req.query.endDate ?? req.query.to) as string | undefined;
    const from = rawStart
      ? new Date(rawStart)
      : new Date(Date.now() - 14 * 86_400_000);
    const to = rawEnd
      ? new Date(rawEnd)
      : new Date(Date.now() + 14 * 86_400_000);

    const db = getTenantClient(req.tenantDbUrl!);
    const isCarkeeper = req.auth?.role === 'carkeeper' || (req.auth?.roles as string[] | undefined)?.includes('carkeeper');
    const vehicleIds = isCarkeeper && req.auth?.userId
      ? await getCarekeeperVehicleIds(db, req.auth.userId)
      : undefined;

    const assignedIds = vehicleIds ?? [];
    console.log(`[Planning] Carkeeper ${req.auth?.userId ?? 'n/a'} → ${isCarkeeper ? assignedIds.length : 'n/a (admin)'} véhicule(s) assigné(s)`);

    // Carkeeper : filtrer strictement par ses véhicules assignés (tableau vide = aucun véhicule)
    // Admin/exploit : aucun filtre véhicule
    const vehicleFilter = isCarkeeper ? { id: { in: assignedIds } } : {};
    const rentalVehicleFilter = isCarkeeper ? { vehicleId: { in: assignedIds } } : {};
    const blockingVehicleFilter = isCarkeeper ? { vehicleId: { in: assignedIds } } : {};
    const unavailabilityVehicleFilter = isCarkeeper ? { vehicleId: { in: assignedIds } } : {};

    const [rentals, blockings, vehicles, unavailabilities, cancelledCount] = await Promise.all([
      db.rental.findMany({
        where: { startAt: { lte: to }, endAt: { gte: from }, status: { not: 'cancelled' }, ...rentalVehicleFilter },
        select: {
          id: true, vehicleId: true, driverName: true, startAt: true, endAt: true, status: true,
          _count: { select: { carSeatRequests: true, accessoryReservations: true } },
          carSeatRequests: { where: { status: { in: ['confirmed', 'pending', 'unavailable'] } }, select: { status: true } },
        },
      }),
      db.blocking.findMany({
        where: { startAt: { lte: to }, endAt: { gte: from }, ...blockingVehicleFilter },
        select: { id: true, vehicleId: true, reason: true, type: true, startAt: true, endAt: true },
      }),
      db.vehicle.findMany({
        where: vehicleFilter,
        select: { id: true, make: true, model: true, licensePlate: true, photoUrl: true, parkingZone: true, deliveryPointName: true },
        orderBy: [{ deliveryPointName: 'asc' }, { make: 'asc' }],
      }),
      db.unavailability.findMany({
        where: { startsAt: { lte: to }, endsAt: { gte: from }, ...unavailabilityVehicleFilter },
        select: { id: true, vehicleId: true, startsAt: true, endsAt: true },
      }),
      db.rental.count({
        where: { startAt: { lte: to }, endAt: { gte: from }, status: 'cancelled', ...rentalVehicleFilter },
      }),
    ]);

    console.log(`[Planning] ${rentals.length} locations chargées, ${cancelledCount} exclues (cancelled)`);
    res.json({ rentals, blockings, vehicles, unavailabilities, period: { from, to } });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/planning/blockings — créer un blocage
router.post('/blockings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = blockingSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const startAt = new Date(body.data.startAt);
    const endAt = new Date(body.data.endAt);
    const blocking = await db.blocking.create({
      data: { ...body.data, startAt, endAt, createdById: req.auth!.userId! },
    });

    // Sync indisponibilité vers Getaround (fire-and-forget)
    void (async () => {
      try {
        const vehicle = await db.vehicle.findUnique({
          where: { id: body.data.vehicleId },
          select: { getaroundId: true, getaroundAccount: { select: { apiKeyHash: true } } },
        });
        if (!vehicle?.getaroundId || !vehicle.getaroundAccount) return;
        const apiKey = decrypt(vehicle.getaroundAccount.apiKeyHash);
        await createGetaroundClient(apiKey).createUnavailability(
          parseInt(vehicle.getaroundId, 10), startAt, endAt, body.data.reason ?? body.data.type,
        );
        console.log(`[Planning] Indisponibilité créée sur Getaround: véhicule ${vehicle.getaroundId}`);
      } catch (err: unknown) { console.error('[Planning] Erreur createUnavailability:', err); }
    })();

    res.status(201).json({ blocking });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/planning/blockings/:id
router.delete('/blockings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const blocking = await db.blocking.findUnique({
      where: { id: req.params.id as string },
      select: { vehicleId: true, startAt: true, endAt: true, vehicle: { select: { getaroundId: true, getaroundAccount: { select: { apiKeyHash: true } } } } },
    });
    await db.blocking.delete({ where: { id: req.params.id as string } });

    // Suppression indisponibilité Getaround (fire-and-forget)
    if (blocking?.vehicle.getaroundId && blocking.vehicle.getaroundAccount) {
      void (async () => {
        try {
          const apiKey = decrypt(blocking.vehicle.getaroundAccount!.apiKeyHash);
          await createGetaroundClient(apiKey).deleteUnavailability(
            parseInt(blocking.vehicle.getaroundId!, 10), blocking.startAt, blocking.endAt,
          );
          console.log(`[Planning] Indisponibilité supprimée sur Getaround: véhicule ${blocking.vehicle.getaroundId}`);
        } catch (err: unknown) { console.error('[Planning] Erreur deleteUnavailability:', err); }
      })();
    }

    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
