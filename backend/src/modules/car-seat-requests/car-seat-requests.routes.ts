import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import { sendCarSeatEmail, type RentalForMessaging } from '../messages/messaging.service';

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

// POST /api/v1/car-seat-requests — créer une demande et exécuter le flux complet
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

    // Vérifier que la location est active/réservée et non terminée — récupère toute l'info rental
    let rentalInfo: RentalForMessaging | null = null;
    if (body.data.rentalId) {
      const rental = await db.rental.findUnique({
        where: { id: body.data.rentalId },
        select: {
          id: true, status: true, endAt: true, startAt: true, driverName: true,
          vehicleId: true, driverGetaroundId: true, getaroundId: true,
          vehicle: { select: { make: true, model: true, licensePlate: true, parkingZone: true, deliveryPointName: true } },
        },
      });
      if (rental && (!['booked', 'active'].includes(rental.status) || rental.endAt <= new Date())) {
        console.log(`[CarSeatRequest] Demande siège ignorée — location passée (rentalId ${body.data.rentalId}, status=${rental.status})`);
        res.status(422).json({ error: 'Demande ignorée — la location est terminée ou passée' });
        return;
      }
      rentalInfo = rental as RentalForMessaging | null;
    }

    // Chercher un siège adapté au poids de l'enfant ET avec stock disponible
    let matchingSeat: { id: string; name: string; minWeightKg: number; maxWeightKg: number } | null = null;
    if (body.data.childWeightKg) {
      matchingSeat = await db.carSeat.findFirst({
        where: {
          isActive: true,
          minWeightKg: { lte: body.data.childWeightKg },
          maxWeightKg: { gte: body.data.childWeightKg },
          availableStock: { gt: 0 },
        },
        orderBy: { minWeightKg: 'asc' },
      });
    }
    // Fallback : n'importe quel siège disponible si pas de correspondance par poids
    if (!matchingSeat) {
      matchingSeat = await db.carSeat.findFirst({ where: { isActive: true, availableStock: { gt: 0 } } });
    }

    const requestStatus = matchingSeat ? 'confirmed' : 'unavailable';

    // Décrémenter le stock immédiatement si un siège est assigné
    if (matchingSeat) {
      await db.carSeat.update({ where: { id: matchingSeat.id }, data: { availableStock: { decrement: 1 } } });
    }

    const request = await db.carSeatRequest.create({
      data: {
        vehicleId: body.data.vehicleId,
        rentalId: body.data.rentalId,
        childWeightKg: body.data.childWeightKg,
        carSeatId: matchingSeat?.id,
        notes: body.data.notes,
        status: requestStatus,
      },
      include: { carSeat: { select: { id: true, name: true, minWeightKg: true, maxWeightKg: true } } },
    });

    console.log(`[CarSeatRequest] Créée — status=${requestStatus} carSeatId=${matchingSeat?.id ?? 'null'} rental=${body.data.rentalId ?? 'n/a'}`);

    // Traitements asynchrones (email + aiSuggestion) si location connue
    if (body.data.rentalId && rentalInfo) {
      const rentalId = body.data.rentalId;
      const seatName = matchingSeat?.name ?? '';
      const confirmed = requestStatus === 'confirmed';
      const rental = rentalInfo;
      void (async () => {
        try {
          const settings = await db.companySettings.findFirst({ select: { aiName: true, senderName: true } });
          const assistantName = settings?.aiName ?? settings?.senderName ?? 'Sun and Drive';

          // Email carkeeper + admin
          const staff = await db.user.findMany({
            where: { isActive: true, OR: [{ role: { in: ['admin', 'carkeeper'] } }, { roles: { hasSome: ['admin', 'carkeeper'] } }] },
            select: { email: true },
          });
          const emails = staff.map(u => u.email).filter((e): e is string => Boolean(e));
          void sendCarSeatEmail(emails, rental, assistantName, confirmed).catch(e =>
            console.error('[CarSeatRequest] Erreur email carkeeper:', e),
          );

          // Générer aiSuggestion (template)
          const firstName = rental.driverName.split(' ')[0] ?? rental.driverName;
          const startStr = rental.startAt.toLocaleDateString('fr-FR');
          const endStr = rental.endAt.toLocaleDateString('fr-FR');
          const aiSuggestion = confirmed
            ? `Bonjour ${firstName}, nous avons bien noté votre demande de siège auto. Nous vous confirmons la disponibilité d'un siège ${seatName} pour votre location du ${startStr} au ${endStr}. Il sera préparé par notre équipe. Cordialement, ${assistantName}`
            : `Bonjour ${firstName}, nous avons bien reçu votre demande de siège auto. Malheureusement nous ne disposons pas de siège adapté pour le moment. Nous vous recontacterons dès que possible. Cordialement, ${assistantName}`;

          // Trouver le dernier message inbound de cette location et y attacher l'aiSuggestion
          const lastInbound = await db.message.findFirst({
            where: { rentalId, direction: 'inbound' },
            orderBy: { createdAt: 'desc' },
          });
          if (lastInbound) {
            await db.message.update({ where: { id: lastInbound.id }, data: { aiSuggestion } });
            await db.message.create({
              data: { rentalId, direction: 'outbound', content: aiSuggestion, status: 'pending_approval', aiSuggestion },
            });
            console.log(`[CarSeatRequest] aiSuggestion + brouillon outbound créés — rental ${rentalId}`);
          }
        } catch (e) {
          console.error('[CarSeatRequest] Erreur traitement async:', e);
        }
      })();
    }

    res.status(201).json({ request });
  } catch (err: unknown) { next(err); }
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
  } catch (err: unknown) { next(err); }
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
  } catch (err: unknown) { next(err); }
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
