import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, getCarekeeperVehicleIds, isOnlyCarkeeper } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// Schéma d'un point de contrôle : {ok: boolean, note?: string}
const checkPointSchema = z.object({ ok: z.boolean(), note: z.string().optional() });

const checkSchema = z.object({
  vehicleId: z.string().min(1),
  checkedAt: z.string().datetime(),
  lighting: z.array(checkPointSchema).length(7),
  levels: z.array(checkPointSchema).length(5),
  glazingMirrors: z.array(checkPointSchema).length(5),
  wipers: z.array(checkPointSchema).length(3),
  tires: z.array(checkPointSchema).length(4),
  braking: z.array(checkPointSchema).length(3),
  engineBattery: z.array(checkPointSchema).length(5),
  safety: z.array(checkPointSchema).length(5),
  roadTest: z.array(checkPointSchema).length(4),
  fuelLevel: z.number().int().min(0).max(100).optional(),
  mileage: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  photos: z.array(z.string()).optional(),
  overallResult: z.enum(['pass', 'advisory', 'fail']).optional(),
  isSynced: z.boolean().optional(),
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicleId = req.query.vehicleId as string | undefined;

    let where: Record<string, unknown> | undefined = vehicleId ? { vehicleId } : undefined;
    if (isOnlyCarkeeper(req.auth) && req.auth?.userId && !vehicleId) {
      const vehicleIds = await getCarekeeperVehicleIds(db, req.auth.userId);
      where = { vehicleId: { in: vehicleIds } };
    }

    const checks = await db.vehicleCheck.findMany({
      where,
      include: {
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
        checkedBy: { select: { id: true, name: true } },
      },
      orderBy: { checkedAt: 'desc' },
    });
    res.json({ checks });
  } catch (err: unknown) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const check = await db.vehicleCheck.findUnique({
      where: { id: (req.params.id as string) },
      include: {
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
    if (!check) { res.status(404).json({ error: 'Fiche introuvable' }); return; }
    res.json({ check });
  } catch (err: unknown) { next(err); }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = checkSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const db = getTenantClient(req.tenantDbUrl!);

    // Calcul automatique du résultat global si non fourni
    const allPoints = [
      ...body.data.lighting, ...body.data.levels, ...body.data.glazingMirrors,
      ...body.data.wipers, ...body.data.tires, ...body.data.braking,
      ...body.data.engineBattery, ...body.data.safety, ...body.data.roadTest,
    ];
    const failCount = allPoints.filter((p) => !p.ok).length;
    const overallResult = body.data.overallResult ?? (failCount === 0 ? 'pass' : failCount <= 3 ? 'advisory' : 'fail');

    const check = await db.vehicleCheck.create({
      data: {
        vehicleId: body.data.vehicleId,
        checkedById: req.auth!.userId!,
        checkedAt: new Date(body.data.checkedAt),
        status: 'completed',
        lighting: body.data.lighting as object,
        levels: body.data.levels as object,
        glazingMirrors: body.data.glazingMirrors as object,
        wipers: body.data.wipers as object,
        tires: body.data.tires as object,
        braking: body.data.braking as object,
        engineBattery: body.data.engineBattery as object,
        safety: body.data.safety as object,
        roadTest: body.data.roadTest as object,
        fuelLevel: body.data.fuelLevel,
        mileage: body.data.mileage,
        notes: body.data.notes,
        photos: (body.data.photos ?? []) as object,
        overallResult,
        isSynced: body.data.isSynced ?? false,
      },
    });
    res.status(201).json({ check });
  } catch (err: unknown) { next(err); }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ status: z.string().optional(), isSynced: z.boolean().optional() }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const check = await db.vehicleCheck.update({ where: { id: (req.params.id as string) }, data: body.data });
    res.json({ check });
  } catch (err: unknown) { next(err); }
});

export default router;
