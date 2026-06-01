import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getMasterClient, getTenantClient } from '../../prisma/client';
import { getSyncState, syncAllAccounts, recalculateHistoricalPayouts, analyzeExistingMessages } from './getaround-sync.service';

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

    // Remet lastSyncAt à NULL — syncAccountRentals calculera startDate = 2 ans en arrière
    await db.getaroundAccount.updateMany({
      where: { isActive: true },
      data: { lastSyncAt: null },
    });

    // Aucun paramètre from/to : syncAllAccounts passe undefined à syncAccountRentals,
    // qui re-lit lastSyncAt (maintenant NULL) et part de 2 ans en arrière.
    void syncAllAccounts(db, tenantSlug)
      .then(r => console.log('[ForceFull] Terminé:', r.length, 'compte(s)'))
      .catch(e => console.error('[ForceFull] Erreur:', e));

    res.json({ message: 'Resync complète lancée' });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/sync/analyze-messages — analyse IA des messages sans aiAnalysis (fire-and-forget)
router.get('/analyze-messages', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const tenantSlug = req.auth?.tenantSlug ?? 'default';
    void analyzeExistingMessages(db, tenantSlug)
      .then(() => console.log(`[IA][${tenantSlug}] analyzeExistingMessages terminé`))
      .catch(e => console.error(`[IA][${tenantSlug}] analyzeExistingMessages erreur:`, e));
    res.json({ message: 'Analyse lancée — résultats dans quelques minutes' });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/sync/recalculate-payouts — recalcul CA réel sur 24 mois (fire-and-forget)
router.get('/recalculate-payouts', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const tenantSlug = req.auth?.tenantSlug ?? 'default';
    void recalculateHistoricalPayouts(db, tenantSlug)
      .then(() => console.log(`[RecalcPayouts][${tenantSlug}] Terminé`))
      .catch(e => console.error(`[RecalcPayouts][${tenantSlug}] Erreur:`, e));
    res.json({ message: 'Recalcul lancé — 20-30 minutes' });
  } catch (err: unknown) { next(err); }
});

export default router;
