import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';
import { computeAvailableStock } from './car-seats.service';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/car-seats
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const seats = await db.carSeat.findMany({
      where: { isActive: true },
      orderBy: { minWeightKg: 'asc' },
    });
    res.json({ seats });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/car-seats
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      minWeightKg: z.number().min(0),
      maxWeightKg: z.number().min(0),
      totalStock: z.number().int().min(0).default(0),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    if (body.data.maxWeightKg <= body.data.minWeightKg) {
      res.status(400).json({ error: 'Poids max doit être supérieur au poids min' }); return;
    }
    const db = getTenantClient(req.tenantDbUrl!);
    const seat = await db.carSeat.create({
      data: {
        name: body.data.name,
        minWeightKg: body.data.minWeightKg,
        maxWeightKg: body.data.maxWeightKg,
        totalStock: body.data.totalStock,
        availableStock: computeAvailableStock({ totalStock: body.data.totalStock, outOfService: 0, isAvailable: true }),
      },
    });
    res.status(201).json({ seat });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/car-seats/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().min(1).optional(),
      minWeightKg: z.number().min(0).optional(),
      maxWeightKg: z.number().min(0).optional(),
      carkeeperId: z.string().nullable().optional(),
      totalStock: z.number().int().min(0).optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const id = req.params.id as string;
    const current = await db.carSeat.findUnique({ where: { id } });
    if (!current) { res.status(404).json({ error: 'Siège introuvable' }); return; }
    const totalStock = body.data.totalStock ?? current.totalStock;
    const seat = await db.carSeat.update({
      where: { id },
      data: {
        ...body.data,
        availableStock: computeAvailableStock({ totalStock, outOfService: current.outOfService, isAvailable: current.isAvailable }),
      },
    });
    res.json({ seat });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/car-seats/:id (soft delete)
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await db.carSeat.update({ where: { id: (req.params.id as string) }, data: { isActive: false } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/car-seats/:id/add-stock — ajouter des unités au stock
router.post('/:id/add-stock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ count: z.number().int().min(1).default(1) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const id = req.params.id as string;
    const current = await db.carSeat.findUnique({ where: { id } });
    if (!current) { res.status(404).json({ error: 'Siège introuvable' }); return; }
    const totalStock = current.totalStock + body.data.count;
    const seat = await db.carSeat.update({
      where: { id },
      data: { totalStock, availableStock: computeAvailableStock({ totalStock, outOfService: current.outOfService, isAvailable: current.isAvailable }) },
    });
    res.json({ seat });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/car-seats/:id/toggle-available — bascule manuelle "Disponible / Pris"
router.post('/:id/toggle-available', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const id = req.params.id as string;
    const current = await db.carSeat.findUnique({ where: { id } });
    if (!current) { res.status(404).json({ error: 'Siège introuvable' }); return; }
    const isAvailable = !current.isAvailable;
    const seat = await db.carSeat.update({
      where: { id },
      data: { isAvailable, availableStock: computeAvailableStock({ totalStock: current.totalStock, outOfService: current.outOfService, isAvailable }) },
    });
    res.json({ seat });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/car-seats/:id/out-of-service — mettre 1 unité hors service
router.post('/:id/out-of-service', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const id = req.params.id as string;
    const current = await db.carSeat.findUnique({ where: { id } });
    if (!current) { res.status(404).json({ error: 'Siège introuvable' }); return; }
    if (current.availableStock <= 0) {
      res.status(400).json({ error: 'Aucune unité disponible à mettre hors service' }); return;
    }
    const outOfService = current.outOfService + 1;
    const seat = await db.carSeat.update({
      where: { id },
      data: { outOfService, availableStock: computeAvailableStock({ totalStock: current.totalStock, outOfService, isAvailable: current.isAvailable }) },
    });
    res.json({ seat });
  } catch (err: unknown) { next(err); }
});

router.post('/:id/in-service', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const id = req.params.id as string;
    const current = await db.carSeat.findUnique({ where: { id } });
    if (!current) { res.status(404).json({ error: 'Siège introuvable' }); return; }
    if (current.outOfService <= 0) {
      res.status(400).json({ error: 'Aucune unité hors service à remettre en service' }); return;
    }
    const outOfService = current.outOfService - 1;
    const seat = await db.carSeat.update({
      where: { id },
      data: { outOfService, availableStock: computeAvailableStock({ totalStock: current.totalStock, outOfService, isAvailable: current.isAvailable }) },
    });
    res.json({ seat });
  } catch (err: unknown) { next(err); }
});

export default router;
