import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router({ mergeParams: true });
router.use(requireAuth, resolveTenant);

// GET /api/v1/vehicles/:vehicleId/ratings
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const ratings = await db.vehicleRating.findMany({
      where: { vehicleId: req.params.vehicleId as string },
      orderBy: { period: 'desc' },
    });
    res.json({ ratings });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/vehicles/:vehicleId/ratings/:period — upsert
router.put('/:period', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      rating: z.number().min(1).max(5),
      reviewCount: z.number().int().min(0).optional(),
      keywords: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const vehicleId = req.params.vehicleId as string;
    const period = req.params.period as string;

    const rating = await db.vehicleRating.upsert({
      where: { vehicleId_period: { vehicleId, period } },
      create: {
        vehicleId,
        period,
        rating: body.data.rating,
        reviewCount: body.data.reviewCount ?? 0,
        keywords: body.data.keywords ?? [],
        notes: body.data.notes,
      },
      update: {
        rating: body.data.rating,
        ...(body.data.reviewCount !== undefined ? { reviewCount: body.data.reviewCount } : {}),
        ...(body.data.keywords !== undefined ? { keywords: body.data.keywords } : {}),
        ...(body.data.notes !== undefined ? { notes: body.data.notes } : {}),
      },
    });
    res.json({ rating });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/vehicles/:vehicleId/ratings/:period
router.delete('/:period', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicleId = req.params.vehicleId as string;
    const period = req.params.period as string;
    const existing = await db.vehicleRating.findUnique({ where: { vehicleId_period: { vehicleId, period } } });
    if (!existing) { res.status(404).json({ error: 'Note introuvable' }); return; }
    await db.vehicleRating.delete({ where: { vehicleId_period: { vehicleId, period } } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
