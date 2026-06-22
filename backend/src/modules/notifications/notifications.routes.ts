import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/notifications?unreadOnly=true&limit=20
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    const unreadOnly = req.query.unreadOnly === 'true';

    const notifications = await db.notification.findMany({
      where: {
        userId: req.auth!.userId!,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json({ notifications });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/notifications/unread-count
router.get('/unread-count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const count = await db.notification.count({
      where: { userId: req.auth!.userId!, isRead: false },
    });
    res.json({ count });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/notifications/read-all
router.put('/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await db.notification.updateMany({
      where: { userId: req.auth!.userId!, isRead: false },
      data: { isRead: true },
    });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/notifications/:id/read
router.put('/:id/read', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const notif = await db.notification.findUnique({ where: { id: (req.params.id as string) } });
    if (!notif || notif.userId !== req.auth!.userId!) {
      res.status(404).json({ error: 'Notification introuvable' });
      return;
    }
    await db.notification.update({ where: { id: (req.params.id as string) }, data: { isRead: true } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/notifications/old — purge des notifications obsolètes
router.delete('/old', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const userId = req.auth!.userId!;
    const now = new Date();
    const thirtyDaysAgo  = new Date(now.getTime() - 30 * 86_400_000);
    const ninetyDaysAgo  = new Date(now.getTime() - 90 * 86_400_000);
    const sevenDaysAgo   = new Date(now.getTime() - 7  * 86_400_000);

    // 1. Notifications lues de plus de 30 jours
    const r1 = await db.notification.deleteMany({
      where: { userId, isRead: true, createdAt: { lt: thirtyDaysAgo } },
    });

    // 2. Notifications non lues de plus de 90 jours
    const r2 = await db.notification.deleteMany({
      where: { userId, isRead: false, createdAt: { lt: ninetyDaysAgo } },
    });

    // 3. Notifications car_seat/accessory dont la location est terminée depuis > 7j
    const staleRentalIds = (
      await db.rental.findMany({
        where: { status: 'completed', endAt: { lt: sevenDaysAgo } },
        select: { id: true },
      })
    ).map(r => r.id);

    let r3 = { count: 0 };
    if (staleRentalIds.length > 0) {
      r3 = await db.notification.deleteMany({
        where: {
          userId,
          type: { in: ['car_seat_request', 'accessory_request'] },
          relatedEntityType: 'rental',
          relatedEntityId: { in: staleRentalIds },
        },
      });
    }

    const deleted = r1.count + r2.count + r3.count;
    console.log(`[Notifications] Nettoyage: ${deleted} supprimée(s)`);
    res.json({ success: true, deleted });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/notifications/all — supprime TOUTES les notifications de l'utilisateur
router.delete('/all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const { count } = await db.notification.deleteMany({
      where: { userId: req.auth!.userId! },
    });
    res.json({ success: true, deleted: count });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/notifications/slack/test — envoie un message test au webhook Slack configuré
router.post('/slack/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const settings = await db.companySettings.findFirst({ select: { slackWebhookUrl: true } });
    if (!settings?.slackWebhookUrl) {
      res.json({ sent: false, reason: 'Webhook Slack non configuré dans les Paramètres' });
      return;
    }
    const response = await fetch(settings.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '🚗 *SunanddriveOS* — Message test Slack ✓\nVotre intégration Slack est bien configurée.' }),
    });
    if (!response.ok) {
      res.json({ sent: false, reason: `Erreur Slack HTTP ${response.status}` });
      return;
    }
    res.json({ sent: true });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/notifications/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const notif = await db.notification.findUnique({ where: { id: (req.params.id as string) } });
    if (!notif || notif.userId !== req.auth!.userId!) {
      res.status(404).json({ error: 'Notification introuvable' });
      return;
    }
    await db.notification.delete({ where: { id: (req.params.id as string) } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
