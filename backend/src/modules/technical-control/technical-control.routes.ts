import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const schema = z.object({
  vehicleId: z.string().min(1),
  performedAt: z.string().datetime(),
  expiryAt: z.string().datetime(),
  result: z.enum(['pass', 'advisory', 'fail']),
  points: z.array(z.object({ label: z.string(), severity: z.string() })).optional(),
  center: z.string().optional(),
  cost: z.number().min(0).optional(),
  documentUrl: z.string().url().optional(),
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicleId = req.query.vehicleId as string | undefined;
    const controls = await db.technicalControl.findMany({
      where: vehicleId ? { vehicleId } : undefined,
      include: { vehicle: { select: { id: true, make: true, model: true, licensePlate: true } } },
      orderBy: { performedAt: 'desc' },
    });
    res.json({ controls });
  } catch (err) { next(err); }
});

// GET /api/v1/technical-control/expiring — CT expirant dans les 60 jours
router.get('/expiring', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const threshold = new Date(Date.now() + 60 * 86_400_000);
    const controls = await db.technicalControl.findMany({
      where: { expiryAt: { lte: threshold }, vehicle: { isActive: true } },
      include: { vehicle: { select: { id: true, make: true, model: true, licensePlate: true } } },
      orderBy: { expiryAt: 'asc' },
    });
    res.json({ controls });
  } catch (err) { next(err); }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = schema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const control = await db.technicalControl.create({
      data: {
        ...body.data,
        performedAt: new Date(body.data.performedAt),
        expiryAt: new Date(body.data.expiryAt),
        points: (body.data.points as never) ?? undefined,
      },
    });
    res.status(201).json({ control });
  } catch (err) { next(err); }
});

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = schema.partial().safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const data = {
      ...body.data,
      ...(body.data.performedAt ? { performedAt: new Date(body.data.performedAt) } : {}),
      ...(body.data.expiryAt ? { expiryAt: new Date(body.data.expiryAt) } : {}),
    };
    const control = await db.technicalControl.update({ where: { id: (req.params.id as string) }, data });
    res.json({ control });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await db.technicalControl.delete({ where: { id: (req.params.id as string) } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
