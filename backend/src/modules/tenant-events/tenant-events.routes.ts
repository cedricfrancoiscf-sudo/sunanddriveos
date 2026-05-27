import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getMasterClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const schema = z.object({
  module: z.string().min(1).max(64),
  action: z.string().min(1).max(64),
});

// POST /api/v1/tenant-events — enregistre un événement d'usage (fire-and-forget côté client)
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = schema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const slug = req.auth?.tenantSlug;
    if (!slug) { res.status(400).json({ error: 'Tenant non identifié' }); return; }

    const master = getMasterClient();
    const company = await master.company.findUnique({ where: { slug }, select: { id: true } });
    if (!company) { res.sendStatus(204); return; }

    await master.tenantEvent.create({
      data: { companyId: company.id, module: body.data.module, action: body.data.action },
    });

    res.sendStatus(204);
  } catch (err: unknown) { next(err); }
});

export default router;
