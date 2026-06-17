import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, isOnlyCarkeeper } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/accessories — liste avec véhicules assignés
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    // Carkeeper : ne voit que les accessoires qui lui sont assignés
    const where = isOnlyCarkeeper(req.auth) && req.auth?.userId
      ? { carekeeperUserId: req.auth.userId }
      : {};
    const accessories = await db.accessory.findMany({
      where,
      include: {
        vehicles: {
          include: {
            vehicle: {
              select: { id: true, make: true, model: true, licensePlate: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ accessories });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/accessories — créer un accessoire
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      quantity: z.number().int().min(1).default(1),
      carekeeperUserId: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const accessory = await db.accessory.create({ data: body.data });
    res.status(201).json({ accessory });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/accessories/:id — modifier un accessoire
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      quantity: z.number().int().min(1).optional(),
      carekeeperUserId: z.string().nullable().optional(),
      carkeeperId: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const accessory = await db.accessory.update({ where: { id: req.params['id'] as string }, data: body.data });
    res.json({ accessory });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/accessories/:id — supprimer un accessoire
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await db.accessoryVehicle.deleteMany({ where: { accessoryId: req.params['id'] as string } });
    await db.accessory.delete({ where: { id: req.params['id'] as string } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/accessories/:id/vehicles — liste des véhicules compatibles
router.get('/:id/vehicles', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const rows = await db.accessoryVehicle.findMany({
      where: { accessoryId: req.params['id'] as string },
      include: { vehicle: { select: { id: true, make: true, model: true, licensePlate: true } } },
    });
    res.json({ vehicles: rows.map(r => r.vehicle) });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/accessories/:id/assign — affecter à un véhicule
router.post('/:id/assign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ vehicleId: z.string().min(1) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'vehicleId requis' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    await db.accessoryVehicle.upsert({
      where: { vehicleId_accessoryId: { vehicleId: body.data.vehicleId, accessoryId: req.params['id'] as string } },
      create: { vehicleId: body.data.vehicleId, accessoryId: req.params['id'] as string },
      update: {},
    });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/accessories/:id/vehicles/:vehicleId — désaffecter d'un véhicule
router.delete('/:id/vehicles/:vehicleId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await db.accessoryVehicle.delete({
      where: { vehicleId_accessoryId: { vehicleId: req.params['vehicleId'] as string, accessoryId: req.params['id'] as string } },
    });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
