import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, getCarekeeperVehicleIds, isOnlyCarkeeper } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import {
  listMaintenances, createMaintenance, updateMaintenance, deleteMaintenance,
  listTasks, updateTask, getTaskHistory, getTaskAlerts, initMaintenanceTasks,
  migrateMaintenanceTasks,
} from './maintenance.service';

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

    if (isOnlyCarkeeper(req.auth) && req.auth?.userId && !vehicleId) {
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
  } catch (err: unknown) { next(err); }
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
      ...(body.data.nextServiceDate ? { nextServiceDate: new Date(body.data.nextServiceDate) } : {}),
    };
    const maintenance = await updateMaintenance(db, (req.params.id as string), data as never);
    res.json({ maintenance });
  } catch (err: unknown) { next(err); }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await deleteMaintenance(db, (req.params.id as string));
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// ─── Routes tâches récurrentes ────────────────────────────────────────────────

// GET /api/v1/maintenance/tasks — liste toutes les tâches CT + révision
router.get('/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const tasks = await listTasks(db);
    res.json({ tasks });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/maintenance/tasks/alerts — alertes à prévoir
router.get('/tasks/alerts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const alerts = await getTaskAlerts(db);
    res.json({ alerts });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/maintenance/tasks/history/:vehicleId — historique lié aux tâches (par véhicule)
router.get('/tasks/history/:vehicleId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const history = await getTaskHistory(db, req.params.vehicleId as string, type);
    res.json({ history });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/maintenance/tasks/:id/history — historique d'une tâche spécifique
router.get('/tasks/:id/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const history = await db.maintenance.findMany({
      where: { maintenanceTaskId: req.params.id as string },
      orderBy: { performedAt: 'desc' },
    });
    res.json({ history });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/maintenance/tasks/:id — enregistrer un CT ou une révision
const taskUpdateSchema = z.object({
  performedAt: z.string().datetime(),
  mileageAtService: z.number().int().min(0),
  cost: z.number().min(0),
  provider: z.string().optional(),
  notes: z.string().optional(),
  nextDueDate: z.string().datetime().optional(),
  nextDueMileage: z.number().int().min(0).optional(),
  ctResult: z.enum(['favorable', 'defavorable', 'contre_visite']).optional(),
});

router.put('/tasks/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = taskUpdateSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const task = await updateTask(db, req.params.id as string, {
      ...body.data,
      performedAt: new Date(body.data.performedAt),
      nextDueDate: body.data.nextDueDate ? new Date(body.data.nextDueDate) : undefined,
      ctResult: body.data.ctResult,
    });
    res.json({ task });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/maintenance/tasks/init — initialise (ou resync) les tâches de tous les véhicules
router.post('/tasks/init', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicles = await db.vehicle.findMany({ select: { id: true } });
    await initMaintenanceTasks(db, vehicles);
    res.json({ success: true, vehicleCount: vehicles.length });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/maintenance/tasks/migrate — migration données existantes vers tâches
// Sûr à ré-exécuter : lie les Maintenance existants et met à jour les cumuls.
router.post('/tasks/migrate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    // S'assurer que les tâches existent d'abord
    const vehicles = await db.vehicle.findMany({ select: { id: true } });
    await initMaintenanceTasks(db, vehicles);
    const result = await migrateMaintenanceTasks(db);
    res.json({ success: true, ...result });
  } catch (err: unknown) { next(err); }
});

export default router;
