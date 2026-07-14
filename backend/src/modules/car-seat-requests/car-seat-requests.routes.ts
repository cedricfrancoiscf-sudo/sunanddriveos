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
    const where: Record<string, unknown> = {};
    if (req.query.status) where.status = req.query.status as string;
    // Exclure les demandes liées à des locations déjà terminées
    where.OR = [
      { rentalId: null },
      { rental: { endAt: { gte: new Date() } } },
    ];
    const requests = await db.carSeatRequest.findMany({
      where,
      include: {
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
        rental: { select: { id: true, driverName: true, startAt: true, endAt: true } },
        carSeat: { select: { id: true, name: true, minWeightKg: true, maxWeightKg: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
    res.json({ requests });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/car-seat-requests — trace une demande siège auto détectée
// (niveau 1, 14/07 : ne pilote plus le stock — cf. CarSeat.isAvailable)
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

    if (body.data.rentalId) {
      const rental = await db.rental.findUnique({
        where: { id: body.data.rentalId },
        select: { status: true, endAt: true },
      });
      if (rental && (!['booked', 'active'].includes(rental.status) || rental.endAt <= new Date())) {
        console.log(`[CarSeatRequest] Demande ignorée — location passée (rentalId ${body.data.rentalId}, status=${rental.status})`);
        res.status(422).json({ error: 'Demande ignorée — la location est terminée ou passée' });
        return;
      }
    }

    const request = await db.carSeatRequest.create({
      data: {
        vehicleId: body.data.vehicleId,
        rentalId: body.data.rentalId,
        childWeightKg: body.data.childWeightKg,
        notes: body.data.notes,
      },
    });

    console.log(`[CarSeatRequest] Tracée — rental=${body.data.rentalId ?? 'n/a'} poids=${body.data.childWeightKg ?? 'n/a'}`);
    res.status(201).json({ request });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/car-seat-requests/:id — mise à jour notes
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ notes: z.string().optional() }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const request = await db.carSeatRequest.update({ where: { id: (req.params.id as string) }, data: body.data });
    res.json({ request });
  } catch (err: unknown) { next(err); }
});

export default router;
