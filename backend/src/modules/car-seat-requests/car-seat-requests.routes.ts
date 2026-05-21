import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/car-seat-requests?status=
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const requests = await db.carSeatRequest.findMany({
      where: req.query.status ? { status: req.query.status as string } : undefined,
      include: {
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
        rental: { select: { id: true, driverName: true, startAt: true, endAt: true } },
        carSeat: { select: { id: true, name: true, minWeightKg: true, maxWeightKg: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
    res.json({ requests });
  } catch (err) { next(err); }
});

// POST /api/v1/car-seat-requests — créer une demande avec poids enfant
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      vehicleId: z.string().min(1),
      rentalId: z.string().optional(),
      childWeightKg: z.number().positive().optional(),
      notes: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const db = getTenantClient(req.tenantDbUrl!);

    // Trouver automatiquement un siège adapté au poids si fourni
    let carSeatId: string | undefined;
    if (body.data.childWeightKg) {
      const match = await db.carSeat.findFirst({
        where: {
          isActive: true,
          minWeightKg: { lte: body.data.childWeightKg },
          maxWeightKg: { gte: body.data.childWeightKg },
          availableStock: { gt: 0 },
        },
        orderBy: { minWeightKg: 'asc' },
      });
      carSeatId = match?.id;
    }

    const request = await db.carSeatRequest.create({
      data: {
        vehicleId: body.data.vehicleId,
        rentalId: body.data.rentalId,
        childWeightKg: body.data.childWeightKg,
        carSeatId,
        notes: body.data.notes,
        status: 'pending',
      },
      include: {
        carSeat: { select: { id: true, name: true, minWeightKg: true, maxWeightKg: true } },
      },
    });

    res.status(201).json({ request });
  } catch (err) { next(err); }
});

// PUT /api/v1/car-seat-requests/:id/confirm — confirmer et décrémenter stock
router.put('/:id/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);

    const existing = await db.carSeatRequest.findUnique({
      where: { id: (req.params.id as string) },
      include: { carSeat: true },
    });
    if (!existing) { res.status(404).json({ error: 'Demande introuvable' }); return; }
    if (existing.status !== 'pending') { res.status(400).json({ error: 'Demande déjà traitée' }); return; }
    if (!existing.carSeatId || !existing.carSeat) {
      res.status(400).json({ error: 'Aucun siège associé — vérifiez le poids de l\'enfant' }); return;
    }
    if (existing.carSeat.availableStock <= 0) {
      res.status(400).json({ error: 'Rupture de stock — siège indisponible' }); return;
    }

    const [updatedSeat, request] = await Promise.all([
      db.carSeat.update({
        where: { id: existing.carSeatId },
        data: { availableStock: { decrement: 1 } },
      }),
      db.carSeatRequest.update({
        where: { id: (req.params.id as string) },
        data: { status: 'confirmed' },
        include: {
          carSeat: { select: { id: true, name: true, minWeightKg: true, maxWeightKg: true } },
        },
      }),
    ]);

    // Alerte rupture de stock : notifier les admins
    const alerts: string[] = [];
    if (updatedSeat.availableStock === 0) {
      alerts.push(`Rupture de stock : ${updatedSeat.name}`);
      const admins = await db.user.findMany({
        where: { role: { in: ['admin', 'exploitation'] as never[] }, isActive: true },
      });
      await Promise.all(admins.map(admin =>
        db.notification.create({
          data: {
            userId: admin.id,
            type: 'car_seat_out_of_stock',
            title: 'Rupture de stock — siège auto',
            body: `Le siège "${updatedSeat.name}" (${updatedSeat.minWeightKg}–${updatedSeat.maxWeightKg} kg) est épuisé.`,
            relatedEntityType: 'car_seat',
            relatedEntityId: updatedSeat.id,
          },
        })
      ));
    }

    res.json({ request, alerts });
  } catch (err) { next(err); }
});

// PUT /api/v1/car-seat-requests/:id/deny — refuser la demande
router.put('/:id/deny', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ notes: z.string().optional() }).safeParse(req.body);
    const db = getTenantClient(req.tenantDbUrl!);
    const request = await db.carSeatRequest.update({
      where: { id: (req.params.id as string) },
      data: { status: 'denied', ...(body.success && body.data.notes ? { notes: body.data.notes } : {}) },
    });
    res.json({ request });
  } catch (err) { next(err); }
});

// PUT /api/v1/car-seat-requests/:id/return — retour du siège, incrémenter stock
router.put('/:id/return', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const existing = await db.carSeatRequest.findUnique({ where: { id: (req.params.id as string) } });
    if (!existing) { res.status(404).json({ error: 'Demande introuvable' }); return; }
    if (existing.status !== 'confirmed') { res.status(400).json({ error: 'Demande non confirmée' }); return; }

    const [, request] = await Promise.all([
      existing.carSeatId
        ? db.carSeat.update({ where: { id: existing.carSeatId }, data: { availableStock: { increment: 1 } } })
        : Promise.resolve(null),
      db.carSeatRequest.update({
        where: { id: (req.params.id as string) },
        data: { status: 'returned' },
        include: { carSeat: { select: { id: true, name: true } } },
      }),
    ]);

    res.json({ request });
  } catch (err) { next(err); }
});

// PUT /api/v1/car-seat-requests/:id — mise à jour notes
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ notes: z.string().optional() }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const request = await db.carSeatRequest.update({ where: { id: (req.params.id as string) }, data: body.data });
    res.json({ request });
  } catch (err) { next(err); }
});

export default router;
