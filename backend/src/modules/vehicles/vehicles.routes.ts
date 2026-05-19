import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import {
  listVehicles,
  getVehicle,
  createVehicle,
  updateVehicle,
  deleteVehicle,
} from './vehicles.service';

const router = Router();
router.use(requireAuth, resolveTenant);

const createSchema = z.object({
  licensePlate: z.string().min(1).max(20),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1),
  color: z.string().optional(),
  photoUrl: z.string().url().optional(),
  currentMileage: z.number().int().min(0).optional(),
  thirdPartyOwnerId: z.string().optional(),
});

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
  healthScore: z.number().int().min(0).max(100).optional(),
});

// GET /api/v1/vehicles
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const includeInactive = req.query.includeInactive === 'true';
    const vehicles = await listVehicles(db, includeInactive);
    res.json({ vehicles });
  } catch (err) { next(err); }
});

// GET /api/v1/vehicles/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicle = await getVehicle(db, (req.params.id as string));
    if (!vehicle) { res.status(404).json({ error: 'Véhicule introuvable' }); return; }
    res.json({ vehicle });
  } catch (err) { next(err); }
});

// POST /api/v1/vehicles
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicle = await createVehicle(db, body.data);
    res.status(201).json({ vehicle });
  } catch (err) { next(err); }
});

// PUT /api/v1/vehicles/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicle = await updateVehicle(db, (req.params.id as string), body.data);
    res.json({ vehicle });
  } catch (err) { next(err); }
});

// DELETE /api/v1/vehicles/:id — soft delete
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await deleteVehicle(db, (req.params.id as string));
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
