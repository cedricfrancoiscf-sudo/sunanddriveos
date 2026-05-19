import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireAuth, requireRole } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient, getMasterClient } from '../../prisma/client';

const router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/settings
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    let settings = await db.companySettings.findFirst();
    if (!settings) {
      settings = await db.companySettings.create({ data: {} });
    }
    res.json({ settings });
  } catch (err) { next(err); }
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
      maintenancePolicies: z.record(z.unknown()).optional(),
      notificationSettings: z.record(z.unknown()).optional(),
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
  } catch (err) { next(err); }
});

// GET /api/v1/settings/ical-info — retourne le token et l'URL iCal
router.get('/ical-info', async (req: Request, res: Response, next: NextFunction) => {
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
  } catch (err) { next(err); }
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
  } catch (err) { next(err); }
});

export default router;
