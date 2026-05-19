import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router = Router();
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
  } catch (err) { next(err); }
});

// GET /api/v1/notifications/unread-count
router.get('/unread-count', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const count = await db.notification.count({
      where: { userId: req.auth!.userId!, isRead: false },
    });
    res.json({ count });
  } catch (err) { next(err); }
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
  } catch (err) { next(err); }
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
  } catch (err) { next(err); }
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
  } catch (err) { next(err); }
});

export default router;
