import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router({ mergeParams: true });
router.use(requireAuth, resolveTenant);

// GET /api/v1/vehicles/:vehicleId/costs
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const costs = await db.vehicleCost.findMany({
      where: { vehicleId: req.params.vehicleId as string },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ costs });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/vehicles/:vehicleId/costs
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      label: z.string().min(1),
      amount: z.number().positive(),
      type: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const cost = await db.vehicleCost.create({
      data: {
        vehicleId: req.params.vehicleId as string,
        label: body.data.label,
        amount: body.data.amount,
        ...(body.data.type ? { type: body.data.type } : {}),
      },
    });
    res.status(201).json({ cost });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/vehicles/:vehicleId/costs/:costId
router.put('/:costId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      label: z.string().min(1).optional(),
      amount: z.number().positive().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const cost = await db.vehicleCost.update({
      where: { id: req.params.costId as string },
      data: body.data,
    });
    res.json({ cost });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/vehicles/:vehicleId/costs/:costId
router.delete('/:costId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await db.vehicleCost.delete({ where: { id: req.params.costId as string } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
