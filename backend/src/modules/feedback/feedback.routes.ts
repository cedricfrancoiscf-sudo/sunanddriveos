import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getMasterClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const schema = z.object({
  type: z.enum(['bug', 'feature', 'feedback']),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
});

// GET /api/v1/feedback/mine — feedbacks du tenant courant
router.get('/mine', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.auth?.tenantSlug;
    if (!slug) { res.status(400).json({ error: 'Tenant non identifié' }); return; }

    const master = getMasterClient();
    const company = await master.company.findUnique({ where: { slug }, select: { id: true } });
    if (!company) { res.json({ feedbacks: [] }); return; }

    const feedbacks = await master.tenantFeedback.findMany({
      where: { companyId: company.id },
      orderBy: { submittedAt: 'desc' },
      take: 50,
      select: { id: true, type: true, title: true, status: true, submittedAt: true },
    });

    res.json({ feedbacks });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/feedback
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = schema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const slug = req.auth?.tenantSlug;
    if (!slug) { res.status(400).json({ error: 'Tenant non identifié' }); return; }

    const master = getMasterClient();
    const company = await master.company.findUnique({ where: { slug }, select: { id: true } });
    if (!company) { res.status(403).json({ error: 'Société introuvable' }); return; }

    const feedback = await master.tenantFeedback.create({
      data: { companyId: company.id, type: body.data.type, title: body.data.title, description: body.data.description },
      select: { id: true, type: true, title: true, status: true, submittedAt: true },
    });

    res.status(201).json({ feedback });
  } catch (err: unknown) { next(err); }
});

export default router;
