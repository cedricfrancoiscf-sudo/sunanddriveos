import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, getCarekeeperVehicleIds } from '../../middleware/auth';
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
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/technical-control/expiring — CT expirant dans les 60 jours
router.get('/expiring', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const threshold = new Date(Date.now() + 60 * 86_400_000);
    const isCarkeeper = req.auth?.role === 'carkeeper' || (req.auth?.roles as string[] | undefined)?.includes('carkeeper');
    const carekeeperIds = isCarkeeper && req.auth?.userId
      ? await getCarekeeperVehicleIds(db, req.auth.userId)
      : undefined;
    const controls = await db.technicalControl.findMany({
      where: {
        expiryAt: { lte: threshold },
        vehicle: { isActive: true },
        archived: false,
        ...(carekeeperIds ? { vehicleId: { in: carekeeperIds } } : {}),
      },
      include: { vehicle: { select: { id: true, make: true, model: true, licensePlate: true } } },
      orderBy: { expiryAt: 'asc' },
    });
    res.json({ controls });
  } catch (err: unknown) { next(err); }
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

    // Archiver l'ancien CT actif du même véhicule
    await db.technicalControl.updateMany({
      where: { vehicleId: body.data.vehicleId, archived: false, id: { not: control.id } },
      data: { archived: true },
    });

    // Notifier admins + carkeepers du véhicule (fire-and-forget)
    void (async () => {
      try {
        const vehicle = await db.vehicle.findUnique({
          where: { id: body.data.vehicleId },
          select: { make: true, model: true, licensePlate: true },
        });
        if (!vehicle) return;
        const label = `${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})`;
        const expiry = new Date(body.data.expiryAt).toLocaleDateString('fr-FR');

        const [admins, carkeepers] = await Promise.all([
          db.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } }),
          db.vehicleCarkeeper.findMany({ where: { vehicleId: body.data.vehicleId }, select: { userId: true } }),
        ]);

        const userIds = [...new Set([...admins.map(u => u.id), ...carkeepers.map(c => c.userId)])];
        if (userIds.length === 0) return;

        await db.notification.createMany({
          data: userIds.map(userId => ({
            userId,
            type: 'ct_expiry',
            title: `Contrôle technique enregistré — ${label}`,
            body: `Résultat : ${body.data.result} — expire le ${expiry}`,
            relatedEntityType: 'technical_control',
            relatedEntityId: control.id,
          })),
          skipDuplicates: true,
        });
      } catch (e) { console.error('[ct notify]', e); }
    })();

    res.status(201).json({ control });
  } catch (err: unknown) { next(err); }
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
  } catch (err: unknown) { next(err); }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await db.technicalControl.delete({ where: { id: (req.params.id as string) } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
