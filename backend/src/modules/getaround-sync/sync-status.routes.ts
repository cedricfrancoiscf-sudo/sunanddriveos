import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getMasterClient, getTenantClient } from '../../prisma/client';
import { getSyncState, syncAllAccounts } from './getaround-sync.service';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/sync/status
router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantSlug = req.auth?.tenantSlug ?? 'default';
    const state = getSyncState(tenantSlug);
    const master = getMasterClient();
    const company = await master.company.findUnique({
      where: { slug: tenantSlug },
      select: { plan: true },
    });
    res.json({ state, plan: company?.plan ?? 'starter' });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/sync/force-full — remet lastSyncAt=null + lance sync complète
router.post('/force-full', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const tenantSlug = req.auth?.tenantSlug ?? 'default';

    // Forcer une re-sync complète depuis le début
    await db.getaroundAccount.updateMany({
      where: { isActive: true },
      data: { lastSyncAt: null },
    });

    void syncAllAccounts(db, tenantSlug)
      .then(r => console.log('[ForceFull] Terminé:', r.length, 'compte(s)'))
      .catch(e => console.error('[ForceFull] Erreur:', e));

    res.json({ message: 'Resync complète lancée' });
  } catch (err: unknown) { next(err); }
});

export default router;
