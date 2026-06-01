import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
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
} from './messages.service';

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
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }).safeParse(req.query);
    if (!q.success) { res.status(400).json({ error: 'Paramètres invalides' }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const result = await listMessages(db, q.data);
    res.json(result);
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/messages/inbox-summary
router.get('/inbox-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const summary = await getInboxSummary(db);
    res.json(summary);
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/messages/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const message = await getMessage(db, (req.params.id as string));
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
router.post('/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ content: z.string().optional() }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const message = await approveMessage(db, (req.params.id as string), req.auth!.userId!, body.data.content);
    res.json({ message });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/messages/:id/mark-sent
router.post('/:id/mark-sent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ getaroundMessageId: z.string().optional() }).safeParse(req.body);
    const db = getTenantClient(req.tenantDbUrl!);
    const message = await markAsSent(db, (req.params.id as string), body.success ? body.data.getaroundMessageId : undefined);
    res.json({ message });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/messages/:id/cancel
router.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const message = await cancelMessage(db, (req.params.id as string));
    res.json({ message });
  } catch (err: unknown) { next(err); }
});

export default router;
