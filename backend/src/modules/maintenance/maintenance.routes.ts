import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, getCarekeeperVehicleIds } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import { listMaintenances, createMaintenance, updateMaintenance, deleteMaintenance } from './maintenance.service';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const schema = z.object({
  vehicleId: z.string().min(1),
  type: z.string().min(1),
  performedAt: z.string().datetime(),
  mileageAtService: z.number().int().min(0),
  nextServiceDate: z.string().datetime().optional(),
  nextServiceMileage: z.number().int().min(0).optional(),
  cost: z.number().min(0).optional(),
  provider: z.string().optional(),
  notes: z.string().optional(),
  documentUrl: z.string().url().optional(),
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicleId = req.query.vehicleId as string | undefined;

    if (req.auth?.role === 'carkeeper' && req.auth.userId && !vehicleId) {
      const vehicleIds = await getCarekeeperVehicleIds(db, req.auth.userId);
      const maintenances = await db.maintenance.findMany({
        where: { vehicleId: { in: vehicleIds } },
        include: { vehicle: { select: { id: true, make: true, model: true, licensePlate: true } } },
        orderBy: { performedAt: 'desc' },
      });
      res.json({ maintenances });
      return;
    }

    const maintenances = await listMaintenances(db, vehicleId);
    res.json({ maintenances });
  } catch (err) { next(err); }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = schema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const maintenance = await createMaintenance(db, {
      ...body.data,
      performedAt: new Date(body.data.performedAt),
      nextServiceDate: body.data.nextServiceDate ? new Date(body.data.nextServiceDate) : undefined,
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

        const [admins, carkeepers] = await Promise.all([
          db.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } }),
          db.vehicleCarkeeper.findMany({ where: { vehicleId: body.data.vehicleId }, select: { userId: true } }),
        ]);

        const userIds = [...new Set([...admins.map(u => u.id), ...carkeepers.map(c => c.userId)])];
        if (userIds.length === 0) return;

        await db.notification.createMany({
          data: userIds.map(userId => ({
            userId,
            type: 'maintenance_due',
            title: `Entretien enregistré — ${label}`,
            body: `Type : ${body.data.type} — ${new Date(body.data.performedAt).toLocaleDateString('fr-FR')}`,
            relatedEntityType: 'maintenance',
            relatedEntityId: maintenance.id,
          })),
          skipDuplicates: true,
        });
      } catch (e) { console.error('[maintenance notify]', e); }
    })();

    res.status(201).json({ maintenance });
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
      ...(body.data.nextServiceDate ? { nextServiceDate: new Date(body.data.nextServiceDate) } : {}),
    };
    const maintenance = await updateMaintenance(db, (req.params.id as string), data as never);
    res.json({ maintenance });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await deleteMaintenance(db, (req.params.id as string));
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
