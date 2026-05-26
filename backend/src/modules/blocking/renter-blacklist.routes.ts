import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/blacklist/renters — liste des locataires blacklistés
router.get('/renters', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const renters = await db.renterBlacklist.findMany({ orderBy: { blacklistedAt: 'desc' } });
    res.json({ renters });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/blacklist/renter — blacklister un locataire (admin only)
router.post('/renter', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      driverGetaroundId: z.string().min(1),
      driverName: z.string().min(1),
      reason: z.string().min(1),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const entry = await db.renterBlacklist.upsert({
      where: { driverGetaroundId: body.data.driverGetaroundId },
      create: body.data,
      update: { reason: body.data.reason, driverName: body.data.driverName },
    });
    res.status(201).json({ entry });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/blacklist/renter/:getaroundId — retirer de la liste noire (admin only)
router.delete('/renter/:getaroundId', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const id = req.params.getaroundId as string;
    const entry = await db.renterBlacklist.findUnique({ where: { driverGetaroundId: id } });
    if (!entry) { res.status(404).json({ error: 'Locataire non trouvé dans la liste noire' }); return; }
    await db.renterBlacklist.delete({ where: { driverGetaroundId: id } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
