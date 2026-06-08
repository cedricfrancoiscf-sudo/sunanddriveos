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

// Normalise chaîne vide → null pour les champs optionnels
const emptyToNull = z.string().nullable().optional().transform(v => (v === '' ? null : v));

const createSchema = z.object({
  licensePlate: z.string().min(1).max(20),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1),
  color: emptyToNull,
  photoUrl: emptyToNull,
  currentMileage: z.number().int().min(0).optional(),
  thirdPartyOwnerId: emptyToNull,
  fuelType: z.enum(['essence', 'diesel', 'electrique', 'hybride', 'gpl']).nullable().optional(),
  parkingZone: emptyToNull,
  deliveryPointName: z.string().nullable().optional(),
  deliveryPostalCode: z.string().max(10).nullable().optional(),
  pickupInstructions: z.string().nullable().optional(),
  returnInstructions: z.string().nullable().optional(),
});

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
  healthScore: z.number().int().min(0).max(100).optional(),
  carekeeperUserId: z.string().nullable().optional(),
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
    console.log('[Vehicle] Create body reçu:', JSON.stringify(req.body));
    const body = createSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    console.log('[Vehicle] Après validation Zod:', JSON.stringify(body.data));
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicle = await createVehicle(db, body.data);
    res.status(201).json({ vehicle });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/vehicles/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[Vehicle] Update body reçu:', JSON.stringify(req.body));
    const body = updateSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }
    console.log('[Vehicle] Après validation Zod:', JSON.stringify(body.data));
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
      select: { id: true, url: true, filename: true, uploadedAt: true, uploadedById: true, isCover: true, latitude: true, longitude: true, accuracy: true, takenAt: true, deviceInfo: true },
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
    const body = req.body as Record<string, string | undefined>;
    const photo = await db.vehiclePhoto.create({
      data: {
        vehicleId: req.params.id as string,
        filename: req.file.filename,
        url: publicUrl,
        uploadedById: req.auth?.userId ?? null,
        ...(body.latitude   ? { latitude:   parseFloat(body.latitude)  } : {}),
        ...(body.longitude  ? { longitude:  parseFloat(body.longitude) } : {}),
        ...(body.accuracy   ? { accuracy:   parseFloat(body.accuracy)  } : {}),
        ...(body.takenAt    ? { takenAt:    new Date(body.takenAt)     } : {}),
        ...(body.deviceInfo ? { deviceInfo: body.deviceInfo            } : {}),
      },
      select: { id: true, url: true, uploadedAt: true, isCover: true, latitude: true, longitude: true, accuracy: true, takenAt: true, deviceInfo: true },
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

const ratingSchema = z.object({
  rating: z.number().min(0).max(5),
  reviewCount: z.number().int().min(0).optional(),
  keywords: z.array(z.string()).optional(),
  notes: z.string().optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

// GET /api/v1/vehicles/:id/ratings
router.get('/:id/ratings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const ratings = await db.vehicleRating.findMany({
      where: { vehicleId: req.params.id as string },
      orderBy: { period: 'desc' },
      take: 12,
    });
    res.json({ ratings });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/vehicles/:id/ratings — upsert sur le mois fourni (ou mois courant)
router.post('/:id/ratings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = ratingSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const vehicleId = req.params.id as string;

    const vehicle = await db.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } });
    if (!vehicle) { res.status(404).json({ error: 'Véhicule introuvable' }); return; }

    const now = new Date();
    const period = body.data.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const rating = await db.vehicleRating.upsert({
      where: { vehicleId_period: { vehicleId, period } },
      create: {
        vehicleId, period,
        rating: body.data.rating,
        reviewCount: body.data.reviewCount ?? 0,
        keywords: body.data.keywords ?? [],
        notes: body.data.notes,
      },
      update: {
        rating: body.data.rating,
        reviewCount: body.data.reviewCount ?? 0,
        keywords: body.data.keywords ?? [],
        notes: body.data.notes,
      },
    });

    res.json({ rating });
  } catch (err: unknown) { next(err); }
});

// ─── Carkeepers par véhicule ─────────────────────────────────────────────────

// GET /api/v1/vehicles/:id/carkeepers
router.get('/:id/carkeepers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const rows = await db.vehicleCarkeeper.findMany({
      where: { vehicleId: req.params.id as string },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
    res.json({ carkeepers: rows });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/vehicles/:id/carkeepers — assigner un carkeeper
router.post('/:id/carkeepers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ userId: z.string().min(1) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'userId requis' }); return; }
    const db = getTenantClient(req.tenantDbUrl!);
    const assignment = await db.vehicleCarkeeper.upsert({
      where: { vehicleId_userId: { vehicleId: req.params.id as string, userId: body.data.userId } },
      create: { vehicleId: req.params.id as string, userId: body.data.userId },
      update: {},
    });
    res.status(201).json({ assignment });
  } catch (err: unknown) { next(err); }
});

// DELETE /api/v1/vehicles/:id/carkeepers/:userId — retirer un carkeeper
router.delete('/:id/carkeepers/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await db.vehicleCarkeeper.delete({
      where: { vehicleId_userId: { vehicleId: req.params.id as string, userId: req.params.userId as string } },
    });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
