import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getSyncState } from './getaround-sync.service';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/sync/status
router.get('/status', (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantSlug = req.auth?.tenantSlug ?? 'default';
    const state = getSyncState(tenantSlug);
    res.json({ state });
  } catch (err: unknown) { next(err); }
});

export default router;
