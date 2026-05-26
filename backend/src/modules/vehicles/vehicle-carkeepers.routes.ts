import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router({ mergeParams: true });
router.use(requireAuth, resolveTenant);

// GET /api/v1/vehicles/:vehicleId/carkeepers
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const carkeepers = await db.vehicleCarkeeper.findMany({
      where: { vehicleId: req.params.vehicleId as string },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { assignedAt: 'asc' },
    });
    res.json({ carkeepers });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/vehicles/:vehicleId/carkeepers — admin only
router.post('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ userId: z.string().min(1) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'userId requis' }); return; }
    const { userId } = body.data;
    const db = getTenantClient(req.tenantDbUrl!);
    const assignment = await db.vehicleCarkeeper.create({
      data: { vehicleId: req.params.vehicleId as string, userId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    res.status(201).json({ assignment });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/vehicles/:vehicleId/carkeepers/:userId — admin only
router.delete('/:userId', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await db.vehicleCarkeeper.delete({
      where: {
        vehicleId_userId: {
          vehicleId: req.params.vehicleId as string,
          userId: req.params.userId as string,
        },
      },
    });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
