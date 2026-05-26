import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
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

const UPLOAD_BASE = process.env.UPLOAD_DIR ?? '/app/uploads';
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const vehicleId = (req.params.id as string | undefined) ?? 'unknown';
    const dir = path.join(UPLOAD_BASE, 'vehicles', vehicleId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_MIMES.has(file.mimetype));
  },
});

const router: Router = Router();
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
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/vehicles/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicle = await getVehicle(db, (req.params.id as string));
    if (!vehicle) { res.status(404).json({ error: 'Véhicule introuvable' }); return; }
    res.json({ vehicle });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/vehicles
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicle = await createVehicle(db, body.data);
    res.status(201).json({ vehicle });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/vehicles/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicle = await updateVehicle(db, (req.params.id as string), body.data);
    res.json({ vehicle });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/vehicles/:id — soft delete
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await deleteVehicle(db, (req.params.id as string));
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/vehicles/:id/photos
router.get('/:id/photos', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const photos = await db.vehiclePhoto.findMany({
      where: { vehicleId: req.params.id as string },
      orderBy: [{ isCover: 'desc' }, { uploadedAt: 'desc' }],
      select: { id: true, url: true, filename: true, uploadedAt: true, uploadedById: true, isCover: true },
    });
    res.json({ photos });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/vehicles/:id/photos
router.post('/:id/photos', upload.single('photo'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'Fichier requis (jpg/png/webp/heic, max 10 Mo)' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const publicUrl = `/uploads/vehicles/${req.params.id as string}/${req.file.filename}`;
    const photo = await db.vehiclePhoto.create({
      data: {
        vehicleId: req.params.id as string,
        filename: req.file.filename,
        url: publicUrl,
        uploadedById: req.auth?.userId ?? null,
      },
      select: { id: true, url: true, uploadedAt: true, isCover: true },
    });
    res.status(201).json({ photo });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/vehicles/:id/photos/:photoId
router.delete('/:id/photos/:photoId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.auth?.role !== 'admin' && !req.auth?.isSuperAdmin) {
      res.status(403).json({ error: 'Réservé aux admins' }); return;
    }
    const db = getTenantClient(req.tenantDbUrl!);
    const photo = await db.vehiclePhoto.findFirst({
      where: { id: req.params.photoId as string, vehicleId: req.params.id as string },
    });
    if (!photo) { res.status(404).json({ error: 'Photo introuvable' }); return; }
    const filePath = path.join(UPLOAD_BASE, 'vehicles', req.params.id as string, photo.filename);
    try { fs.unlinkSync(filePath); } catch { /* fichier déjà supprimé */ }
    await db.vehiclePhoto.delete({ where: { id: photo.id } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// PATCH /api/v1/vehicles/:id/photos/:photoId/cover
router.patch('/:id/photos/:photoId/cover', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicleId = req.params.id as string;
    const photoId = req.params.photoId as string;
    await db.vehiclePhoto.updateMany({ where: { vehicleId }, data: { isCover: false } });
    const photo = await db.vehiclePhoto.update({ where: { id: photoId }, data: { isCover: true } });
    res.json({ photo });
  } catch (err: unknown) { next(err); }
});

export default router;
