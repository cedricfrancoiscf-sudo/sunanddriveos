import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getMasterClient } from '../../prisma/client';

const router: Router = Router();

// GET /api/v1/nps/settings — intervalle NPS + lastNpsAt du tenant courant
router.get('/settings', requireAuth, resolveTenant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const [config, company] = await Promise.all([
      master.superAdminConfig.findUnique({ where: { key: 'nps_interval_days' } }),
      master.company.findFirst({ where: { slug: req.auth!.tenantSlug }, select: { lastNpsAt: true } }),
    ]);
    res.json({
      intervalDays: config ? parseInt(config.value, 10) : 90,
      lastNpsAt: company?.lastNpsAt ?? null,
    });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/nps — soumettre une réponse NPS
router.post('/', requireAuth, resolveTenant, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      score: z.number().int().min(0).max(10),
      comment: z.string().max(1000).optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const master = getMasterClient();
    const company = await master.company.findFirst({
      where: { slug: req.auth!.tenantSlug },
      select: { id: true },
    });
    if (!company) { res.status(404).json({ error: 'Société introuvable' }); return; }

    const [nps] = await Promise.all([
      master.npsResponse.create({
        data: {
          companyId: company.id,
          score: body.data.score,
          comment: body.data.comment,
          respondedBy: req.auth?.userId ?? undefined,
        },
      }),
      master.company.update({
        where: { id: company.id },
        data: { lastNpsAt: new Date() },
      }),
    ]);

    res.status(201).json({ nps });
  } catch (err: unknown) { next(err); }
});

export default router;
