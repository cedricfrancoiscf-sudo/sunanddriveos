// Module supprimé — les CT sont désormais gérés via MaintenanceTask (type: 'ct')
// Voir backend/src/modules/maintenance/maintenance.routes.ts
import { Router } from 'express';
const router: Router = Router();
router.all('*', (_req, res) => res.status(410).json({ error: 'Ce module est obsolète. Utiliser /api/v1/maintenance.' }));
export default router;
