import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, isOnlyCarkeeper, getCarekeeperVehicleIds } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import {
  listMessages,
  getMessage,
  createOutboundMessage,
  approveMessage,
  markAsSent,
  cancelMessage,
  getInboxSummary,
  dismissThread,
  undismissThread,
  autoCloseStaleThreads,
} from './messages.service';
import { analyzeAndProcessMessage } from './messaging.service';
import { decrypt } from '../../utils/crypto';
import { createGetaroundClient } from '../getaround-sync/getaround-api';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/messages
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z.object({
      rentalId: z.string().optional(),
      vehicleId: z.string().optional(),
      rentalStatus: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      direction: z.enum(['inbound', 'outbound']).optional(),
      sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }).safeParse(req.query);
    if (!q.success) { res.status(400).json({ error: 'Paramètres invalides' }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const filters = { ...q.data } as typeof q.data & { vehicleIds?: string[] };
    if (isOnlyCarkeeper(req.auth)) {
      const assigned = await getCarekeeperVehicleIds(db, req.auth!.userId!);
      if (assigned.length === 0) { res.json({ messages: [], total: 0, page: 1, limit: 50 }); return; }
      filters.vehicleIds = assigned;
    }
    const result = await listMessages(db, filters);
    res.json(result);
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/messages/inbox-summary
router.get('/inbox-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    let vehicleIds: string[] | undefined;
    if (isOnlyCarkeeper(req.auth)) {
      vehicleIds = await getCarekeeperVehicleIds(db, req.auth!.userId!);
    }
    const summary = await getInboxSummary(db, vehicleIds);
    res.json(summary);
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/messages/auto-close/run — déclenche la clôture auto immédiatement
// (calibration/vérification du seuil sans attendre le cron 7h)
router.post('/auto-close/run', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const settings = await db.companySettings.findFirst({ select: { threadAutoCloseDays: true } });
    const autoCloseDays = settings?.threadAutoCloseDays ?? 7;
    const result = await autoCloseStaleThreads(db, autoCloseDays);
    res.json({ success: true, ...result, autoCloseDays });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/messages/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const message = await getMessage(db, req.params.id as string);
    if (!message) { res.status(404).json({ error: 'Message introuvable' }); return; }
    res.json({ message });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/messages — créer un message sortant (réponse manuelle)
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      rentalId: z.string().min(1),
      content: z.string().min(1),
      aiSuggestion: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const message = await createOutboundMessage(db, body.data.rentalId, body.data.content, body.data.aiSuggestion);
    res.status(201).json({ message });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/messages/:id/approve
router.post('/:id/approve', requireAuth, resolveTenant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const body = z.object({ content: z.string().optional() }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const message = await db.message.findUnique({
      where: { id: req.params.id as string },
      include: {
        rental: {
          select: {
            getaroundId: true,
            vehicle: {
              select: {
                getaroundAccount: { select: { apiKeyHash: true } },
              },
            },
          },
        },
      },
    });

    if (!message) { res.status(404).json({ error: 'Message introuvable' }); return; }

    const content = body.data.content ?? message.content;

    await approveMessage(db, req.params.id as string, req.auth!.userId!, content);

    try {
      const apiKeyHash = message.rental.vehicle.getaroundAccount?.apiKeyHash;
      if (!apiKeyHash) throw new Error('Compte Getaround introuvable');

      const apiKey = decrypt(apiKeyHash);
      const ga = createGetaroundClient(apiKey);
      const rentalId = parseInt(message.rental.getaroundId, 10);

      const sent = await ga.sendMessage(rentalId, content);

      await markAsSent(db, req.params.id as string, String(sent.id));

      console.log(`[Messages] Message ${req.params.id as string} approuvé et envoyé (rental ${rentalId})`);
      res.json({ success: true, status: 'sent' });
    } catch (sendErr) {
      console.error('[Messages] Erreur envoi Getaround:', sendErr instanceof Error ? sendErr.message : sendErr);
      res.json({ success: true, status: 'approved', warning: 'Approuvé mais erreur envoi Getaround — réessayez' });
    }
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/messages/:id/mark-sent
router.post('/:id/mark-sent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ getaroundMessageId: z.string().optional() }).safeParse(req.body);
    const db = getTenantClient(req.tenantDbUrl!);
    const message = await markAsSent(db, req.params.id as string, body.success ? body.data.getaroundMessageId : undefined);
    res.json({ message });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/messages/:id/cancel
router.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const message = await cancelMessage(db, req.params.id as string);
    res.json({ message });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/messages/rental/:rentalId/dismiss — clôturer le fil sans réponse
router.post('/rental/:rentalId/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const result = await dismissThread(db, req.params.rentalId as string);
    res.json({ success: true, ...result });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/messages/rental/:rentalId/undismiss — réouvrir un fil clôturé
router.post('/rental/:rentalId/undismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const result = await undismissThread(db, req.params.rentalId as string);
    res.json({ success: true, ...result });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/messages/rental/:rentalId/regenerate — régénérer le brouillon IA
router.post('/rental/:rentalId/regenerate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const rentalId = req.params.rentalId as string;

    // Annuler le brouillon pending existant
    await db.message.updateMany({
      where: { rentalId, direction: 'outbound', status: 'pending_approval' },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });

    // Trouver le dernier message inbound pour le contexte
    const lastInbound = await db.message.findFirst({
      where: { rentalId, direction: 'inbound' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, content: true, sentAt: true },
    });

    if (!lastInbound) {
      res.json({ success: true, message: 'Aucun message inbound trouvé' });
      return;
    }

    // Construire le contexte de la location
    const rental = await db.rental.findUnique({
      where: { id: rentalId },
      select: {
        id: true, vehicleId: true, driverName: true, driverGetaroundId: true,
        getaroundId: true, startAt: true, endAt: true, status: true,
        vehicle: {
          select: {
            make: true, model: true, licensePlate: true,
            parkingZone: true, deliveryPointName: true, getaroundAccountId: true,
          },
        },
      },
    });

    if (!rental?.vehicle.getaroundAccountId) {
      res.json({ success: true, message: 'Compte Getaround introuvable' });
      return;
    }

    const account = await db.getaroundAccount.findUnique({
      where: { id: rental.vehicle.getaroundAccountId },
      select: { apiKeyHash: true },
    });

    if (!account) {
      res.json({ success: true, message: 'Compte Getaround introuvable' });
      return;
    }

    const ga = createGetaroundClient(decrypt(account.apiKeyHash));

    // Lancer la régénération en arrière-plan (pas de blocage HTTP)
    void analyzeAndProcessMessage(
      lastInbound,
      {
        id: rental.id,
        vehicleId: rental.vehicleId,
        driverName: rental.driverName,
        driverGetaroundId: rental.driverGetaroundId,
        getaroundId: rental.getaroundId,
        startAt: rental.startAt,
        endAt: rental.endAt,
        status: rental.status,
        vehicle: {
          make: rental.vehicle.make,
          model: rental.vehicle.model,
          licensePlate: rental.vehicle.licensePlate,
          parkingZone: rental.vehicle.parkingZone,
          deliveryPointName: rental.vehicle.deliveryPointName,
        },
      },
      db,
      ga,
    ).catch(e => console.error('[Regenerate] Erreur:', e));

    res.json({ success: true, message: 'Régénération lancée' });
  } catch (err: unknown) { next(err); }
});

export default router;
