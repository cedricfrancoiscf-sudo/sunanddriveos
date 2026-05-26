import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, process.env.UPLOAD_PATH ?? 'uploads'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.UPLOAD_MAX_SIZE_MB ?? '10', 10)) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

const DOC_TYPES = ['insurance', 'registration', 'lease', 'technical_control', 'other'] as const;

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicleId = req.query.vehicleId as string | undefined;
    const docs = await db.vehicleDocument.findMany({
      where: vehicleId ? { vehicleId } : undefined,
      include: { vehicle: { select: { id: true, make: true, model: true, licensePlate: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ documents: docs });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/documents/expiring — documents expirant dans les 30 jours
router.get('/expiring', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const threshold = new Date(Date.now() + 30 * 86_400_000);
    const docs = await db.vehicleDocument.findMany({
      where: { expiryDate: { lte: threshold }, vehicle: { isActive: true } },
      include: { vehicle: { select: { id: true, make: true, model: true, licensePlate: true } } },
      orderBy: { expiryDate: 'asc' },
    });
    res.json({ documents: docs });
  } catch (err: unknown) { next(err); }
});

router.post('/', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      vehicleId: z.string().min(1),
      type: z.enum(DOC_TYPES),
      name: z.string().min(1),
      expiryDate: z.string().datetime().optional(),
      reminderDays: z.coerce.number().int().min(1).optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const fileUrl = req.file ? `/uploads/${req.file.filename}` : '';
    if (!fileUrl) { res.status(400).json({ error: 'Fichier requis' }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const doc = await db.vehicleDocument.create({
      data: {
        vehicleId: body.data.vehicleId,
        type: body.data.type,
        name: body.data.name,
        fileUrl,
        expiryDate: body.data.expiryDate ? new Date(body.data.expiryDate) : undefined,
        reminderDays: body.data.reminderDays ?? 30,
      },
    });
    res.status(201).json({ document: doc });
  } catch (err: unknown) { next(err); }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    await db.vehicleDocument.delete({ where: { id: (req.params.id as string) } });
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
