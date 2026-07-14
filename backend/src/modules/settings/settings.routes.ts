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

const UPLOAD_ROOT = process.env.UPLOAD_PATH ?? path.join(process.cwd(), 'uploads');

// Multer en mémoire — on détermine le chemin final après avoir connu le slug
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Format non supporté (PNG, JPG, SVG uniquement)'));
  },
});

function publicUrl(urlPath: string): string {
  const base = (process.env.PUBLIC_URL ?? process.env.FRONTEND_URL ?? 'https://appli.sunanddrive.com').replace(/\/$/, '');
  return `${base}${urlPath}`;
}

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
      getaroundRules: z.string().max(20000).nullable().optional(),
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
      // Séquences
      minMessageInterval: z.number().int().min(0).max(1440).optional(),
      // Intelligence
      ratingDropThreshold: z.number().min(0).max(5).optional(),
      underutilizationThreshold: z.number().min(0).max(1).optional(),
      underutilizationWeeks: z.number().int().min(1).max(52).optional(),
      riskScoreAlertThreshold: z.number().int().min(0).max(100).optional(),
      riskWeightScore: z.number().int().min(0).max(100).optional(),
      riskWeightFlags: z.number().int().min(0).max(100).optional(),
      riskWeightCancelled: z.number().int().min(0).max(100).optional(),
      riskWeightDelay: z.number().int().min(0).max(100).optional(),
      boitierConnectAmount: z.number().int().min(0).max(500).nullable().optional(),
      slackWebhookUrl: z.string().nullable().optional(),
      // Revente & Décote
      depreciationRateYear1: z.number().min(0).max(1).optional(),
      depreciationRateYear2: z.number().min(0).max(1).optional(),
      depreciationRateYear3: z.number().min(0).max(1).optional(),
      depreciationRateYears4to6: z.number().min(0).max(1).optional(),
      depreciationRateAfter6: z.number().min(0).max(1).optional(),
      majorMaintenanceCost: z.number().min(0).max(50000).optional(),
      majorMaintenanceKm: z.number().int().min(1000).max(200000).optional(),
      roiAlertMonthsBefore: z.number().int().min(1).max(24).optional(),
      roiCaMoyenMois: z.number().int().min(1).max(24).optional(),
      roiHorizonMonths: z.number().int().min(12).max(120).optional(),
      roiCoeffSaison: z.array(z.number().min(0.1).max(3.0)).length(12).nullable().optional(),
      platformName: z.string().min(1).max(100).nullable().optional(),
      platformCommissionRate: z.number().min(1.0).max(2.0).nullable().optional(),
      kmDeclinCA: z.number().int().min(50000).max(300000).optional(),
      kmStopGA: z.number().int().min(50000).max(400000).optional(),
      defaultDepreciationRate: z.number().min(0).max(2000).optional(),
      messageUnansweredMinutes: z.number().int().min(5).max(240).nullable().optional(),
      threadAutoCloseDays: z.number().int().min(1).max(90).nullable().optional(),
      ctAlertWindowDays: z.number().int().min(7).max(180).nullable().optional(),
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
  logoUpload.single('logo')(req, res, async (err) => {
    if (err) { res.status(400).json({ error: err.message }); return; }
    if (!req.file) { res.status(400).json({ error: 'Fichier manquant' }); return; }
    try {
      const slug = req.auth!.tenantSlug!;
      const ext = req.file.mimetype === 'image/svg+xml' ? 'svg' : req.file.mimetype === 'image/png' ? 'png' : 'jpg';
      // Fichier canonique par tenant — un seul logo, pas de prolifération UUID
      const filename = `logo.${ext}`;
      const tenantDir = path.join(UPLOAD_ROOT, 'tenants', slug);
      fs.mkdirSync(tenantDir, { recursive: true });
      fs.writeFileSync(path.join(tenantDir, filename), req.file.buffer);

      const logoUrl = publicUrl(`/uploads/tenants/${slug}/${filename}`);

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
    const baseUrl = (process.env.PUBLIC_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:4000').replace(/\/$/, '');
    const icalUrl = token ? `${baseUrl}/ical/${token}/accessories.ics` : null;
    res.json({ icalToken: token, icalUrl });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/settings/clean-vehicle-instructions — nettoyage one-shot du markdown stocké en base
// (à appeler une fois après déploiement si les données contiennent encore des * ou **)
router.post('/clean-vehicle-instructions', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    function stripMd(text: string): string {
      return text
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/^[*\-]\s+/gm, '• ')
        .replace(/__([^_]*)__/g, '$1')
        .replace(/_([^_]*)_/g, '$1')
        .trim();
    }
    const db = getTenantClient(req.tenantDbUrl!);
    const vehicles = await db.vehicle.findMany({
      where: { OR: [{ pickupInstructions: { contains: '*' } }, { returnInstructions: { contains: '*' } }] },
      select: { id: true, licensePlate: true, pickupInstructions: true, returnInstructions: true },
    });
    const fixed: string[] = [];
    for (const v of vehicles) {
      const newPickup = v.pickupInstructions ? stripMd(v.pickupInstructions) : null;
      const newReturn = v.returnInstructions ? stripMd(v.returnInstructions) : null;
      if (newPickup !== v.pickupInstructions || newReturn !== v.returnInstructions) {
        await db.vehicle.update({ where: { id: v.id }, data: { pickupInstructions: newPickup, returnInstructions: newReturn } });
        fixed.push(v.licensePlate);
      }
    }
    res.json({ fixed: fixed.length, vehicles: fixed });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/settings/ical-regenerate — (re)génère le token iCal
router.post('/ical-regenerate', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const master = getMasterClient();
    const tenantSlug = req.auth!.tenantSlug!;
    const newToken = randomUUID();
    await master.company.update({ where: { slug: tenantSlug }, data: { icalToken: newToken } });
    const baseUrl = (process.env.PUBLIC_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:4000').replace(/\/$/, '');
    const icalUrl = `${baseUrl}/ical/${newToken}/accessories.ics`;
    res.json({ icalToken: newToken, icalUrl });
  } catch (err: unknown) { next(err); }
});

export default router;
