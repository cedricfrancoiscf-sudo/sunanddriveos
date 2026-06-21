import path from 'path';
import fs from 'fs';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { requireAuth, requireRole } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient, getMasterClient } from '../../prisma/client';
import { sendAlertEmail } from '../../utils/mailer';

const LOGO_DIR = process.env.UPLOAD_PATH ? path.join(process.env.UPLOAD_PATH, 'logos') : path.join(process.cwd(), 'uploads', 'logos');
const logoUpload = multer({
  dest: LOGO_DIR,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Format non supporté (PNG, JPG, SVG uniquement)'));
  },
});

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/settings
router.get('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    let settings = await db.companySettings.findFirst();
    if (!settings) {
      settings = await db.companySettings.create({ data: {} });
    }
    res.json({ settings });
  } catch (err: unknown) { next(err); }
});

// PUT /api/v1/settings
router.put('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      logoUrl: z.string().url().optional(),
      aiModeCarSeat: z.enum(['auto', 'approval', 'manual']).optional(),
      aiModeIncident: z.enum(['auto', 'approval', 'manual']).optional(),
      aiModeGeneral: z.enum(['auto', 'approval', 'manual']).optional(),
      aiTone: z.enum(['vouvoiement', 'tutoiement']).optional(),
      aiName: z.string().min(2).max(20).regex(/^[a-zA-ZÀ-ÿ]+$/, 'Lettres uniquement').optional(),
      fontFamily: z.string().min(1).max(50).optional(),
      alertEmails: z.array(z.string().email()).max(10).optional(),
      replyToEmail: z.string().email().nullable().optional(),
      senderName: z.string().min(2).max(50).nullable().optional(),
      maintenancePolicies: z.record(z.unknown()).optional(),
      notificationSettings: z.record(z.unknown()).optional(),
      autobizApiKey: z.string().max(200).nullable().optional(),
      depreciationThreshold: z.number().min(0).max(10).optional(),
      warrantyAlertDays: z.number().int().min(1).max(365).optional(),
      co2FactorEssence: z.number().min(0).max(500).optional(),
      co2FactorHybride: z.number().min(0).max(500).optional(),
      co2FactorElectrique: z.number().min(0).max(500).optional(),
      co2EquivalentArbre: z.number().min(0.1).max(100).optional(),
      journalCode: z.string().min(1).max(10).optional(),
      compteLocationsProduit: z.string().min(1).max(10).optional(),
      compteCompensationsProduit: z.string().min(1).max(10).optional(),
      compteEntretienCharge: z.string().min(1).max(10).optional(),
      compteAssuranceCharge: z.string().min(1).max(10).optional(),
      compteParkingCharge: z.string().min(1).max(10).optional(),
      formatExportPreference: z.enum(['fec', 'csv']).optional(),
      objectifSeuilAlerte: z.number().int().min(1).max(100).optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides', details: body.error.flatten() }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    let settings = await db.companySettings.findFirst();
    if (settings) {
      settings = await db.companySettings.update({ where: { id: settings.id }, data: body.data as never });
    } else {
      settings = await db.companySettings.create({ data: body.data as never });
    }
    res.json({ settings });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/settings/logo — upload logo (multipart/form-data)
router.post('/logo', requireRole('admin'), (req: Request, res: Response, next: NextFunction) => {
  fs.mkdirSync(LOGO_DIR, { recursive: true });
  logoUpload.single('logo')(req, res, async (err) => {
    if (err) { res.status(400).json({ error: err.message }); return; }
    if (!req.file) { res.status(400).json({ error: 'Fichier manquant' }); return; }
    try {
      const ext = req.file.mimetype === 'image/svg+xml' ? 'svg' : req.file.mimetype === 'image/png' ? 'png' : 'jpg';
      const filename = `${randomUUID()}.${ext}`;
      const destPath = path.join(LOGO_DIR, filename);
      fs.renameSync(req.file.path, destPath);
      const baseUrl = (process.env.BACKEND_URL ?? 'http://localhost:4000/api/v1').replace('/api/v1', '');
      const logoUrl = `${baseUrl}/uploads/logos/${filename}`;

      const db = getTenantClient(req.tenantDbUrl!);
      let settings = await db.companySettings.findFirst();
      if (settings) {
        settings = await db.companySettings.update({ where: { id: settings.id }, data: { logoUrl } });
      } else {
        settings = await db.companySettings.create({ data: { logoUrl } });
      }
      res.json({ logoUrl });
    } catch (uploadErr) { next(uploadErr); }
  });
});

// POST /api/v1/settings/test-email — envoie un email de test aux alertEmails configurés
router.post('/test-email', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const settings = await db.companySettings.findFirst();
    const alertEmails = settings?.alertEmails ?? [];
    if (alertEmails.length === 0) {
      res.status(400).json({ error: 'Aucun destinataire configuré' });
      return;
    }
    await sendAlertEmail({
      alertEmails,
      subject: 'Email de test — SunanddriveOS',
      html: '<p>Ceci est un email de test envoyé depuis vos paramètres SunanddriveOS.</p><p>Si vous recevez cet email, vos alertes sont correctement configurées ✅</p>',
      senderName: settings?.senderName ?? undefined,
      replyToEmail: settings?.replyToEmail ?? undefined,
    });
    res.json({ success: true, sentTo: alertEmails });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/settings/ical-info — retourne le token et l'URL iCal (admin uniquement)
router.get('/ical-info', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const tenantSlug = req.auth!.tenantSlug!;
    const company = await master.company.findUnique({
      where: { slug: tenantSlug },
      select: { icalToken: true },
    });
    const token = company?.icalToken ?? null;
    const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
    const icalUrl = token ? `${baseUrl}/ical/${token}/accessories.ics` : null;
    res.json({ icalToken: token, icalUrl });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/settings/ical-regenerate — (re)génère le token iCal
router.post('/ical-regenerate', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const tenantSlug = req.auth!.tenantSlug!;
    const newToken = randomUUID();
    await master.company.update({ where: { slug: tenantSlug }, data: { icalToken: newToken } });
    const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
    const icalUrl = `${baseUrl}/ical/${newToken}/accessories.ics`;
    res.json({ icalToken: newToken, icalUrl });
  } catch (err: unknown) { next(err); }
});

export default router;
