import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const INCLUDE = {
  accessory: { select: { id: true, name: true } },
  rental: {
    select: {
      id: true, driverName: true, startAt: true, endAt: true,
      vehicle: { select: { id: true, make: true, model: true, licensePlate: true, parkingZone: true } },
    },
  },
};

// GET /api/v1/accessory-reservations?accessoryId=&status=
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const where: Record<string, unknown> = {};
    if (req.query.accessoryId) where.accessoryId = req.query.accessoryId;
    if (req.query.status) where.status = req.query.status;

    const reservations = await db.accessoryReservation.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ reservations });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/accessory-reservations
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      accessoryId: z.string().min(1),
      rentalId: z.string().min(1),
      notes: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const db = getTenantClient(req.tenantDbUrl!);

    // Récupérer le vehicleId depuis la location
    const rental = await db.rental.findUnique({ where: { id: body.data.rentalId }, select: { vehicleId: true } });
    if (!rental) { res.status(404).json({ error: 'Location introuvable' }); return; }

    const reservation = await db.accessoryReservation.create({
      data: {
        accessoryId: body.data.accessoryId,
        rentalId: body.data.rentalId,
        vehicleId: rental.vehicleId,
        notes: body.data.notes,
        status: 'pending',
      },
      include: INCLUDE,
    });
    res.status(201).json({ reservation });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/accessory-reservations/:id/confirm
router.put('/:id/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const existing = await db.accessoryReservation.findUnique({ where: { id: (req.params.id as string) } });
    if (!existing) { res.status(404).json({ error: 'Réservation introuvable' }); return; }
    if (existing.status !== 'pending') { res.status(400).json({ error: 'Réservation déjà traitée' }); return; }

    const reservation = await db.accessoryReservation.update({
      where: { id: (req.params.id as string) },
      data: { status: 'confirmed' },
      include: INCLUDE,
    });
    res.json({ reservation });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/accessory-reservations/:id/return
router.put('/:id/return', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const existing = await db.accessoryReservation.findUnique({ where: { id: (req.params.id as string) } });
    if (!existing) { res.status(404).json({ error: 'Réservation introuvable' }); return; }
    if (existing.status !== 'confirmed') { res.status(400).json({ error: 'Réservation non confirmée' }); return; }

    const reservation = await db.accessoryReservation.update({
      where: { id: (req.params.id as string) },
      data: { status: 'returned' },
      include: INCLUDE,
    });
    res.json({ reservation });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/accessory-reservations/:id/cancel
router.put('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const reservation = await db.accessoryReservation.update({
      where: { id: (req.params.id as string) },
      data: { status: 'cancelled' },
      include: INCLUDE,
    });
    res.json({ reservation });
  } catch (err: unknown) { next(err); }
});

export default router;
