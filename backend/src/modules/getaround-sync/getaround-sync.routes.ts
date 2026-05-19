import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import {
  listAccounts,
  createAccount,
  updateAccountKey,
  deleteAccount,
  syncAccountVehicles,
  syncAllAccounts,
  syncAccountRentals,
} from './getaround-sync.service';

const router = Router();
router.use(requireAuth, resolveTenant);

const adminOnly = requireRole('admin');

// GET /api/v1/getaround-sync/accounts
router.get('/accounts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const accounts = await listAccounts(db);
    // On ne renvoie jamais la clé API déchiffrée
    const safe = accounts.map(({ apiKeyHash: _, ...a }) => a);
    res.json({ accounts: safe });
  } catch (err) { next(err); }
});

// POST /api/v1/getaround-sync/accounts
router.post('/accounts', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ name: z.string().min(1), apiKey: z.string().min(10) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const account = await createAccount(db, body.data.name, body.data.apiKey);
    const { apiKeyHash: _, ...safe } = account;
    res.status(201).json({ account: safe });
  } catch (err) { next(err); }
});

// PUT /api/v1/getaround-sync/accounts/:id/key
router.put('/accounts/:id/key', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ apiKey: z.string().min(10) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    await updateAccountKey(db, (req.params.id as string), body.data.apiKey);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /api/v1/getaround-sync/accounts/:id
router.delete('/accounts/:id', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await deleteAccount(db, (req.params.id as string));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/v1/getaround-sync/sync/:accountId — sync un compte
router.post('/sync/:accountId', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const result = await syncAccountVehicles(db, (req.params.accountId as string));
    res.json({ result });
  } catch (err) { next(err); }
});

// POST /api/v1/getaround-sync/sync-all — sync tous les comptes actifs (véhicules)
router.post('/sync-all', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const results = await syncAllAccounts(db);
    res.json({ results });
  } catch (err) { next(err); }
});

// POST /api/v1/getaround-sync/sync-rentals/:accountId — sync locations d'un compte
router.post('/sync-rentals/:accountId', adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const db = getTenantClient(req.tenantDbUrl!);
    const result = await syncAccountRentals(
      db,
      (req.params.accountId as string),
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
    res.json({ result });
  } catch (err) { next(err); }
});

export default router;
