import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient, getMasterClient } from '../../prisma/client';

const router: Router = Router();
router.use(requireAuth, resolveTenant);

// GET /api/v1/onboarding/progress
// Dérive l'état de chaque step depuis les données existantes — pas de colonne dédiée
router.get('/progress', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);

    const [settings, accountCount, vehicleCount, userCount, sequenceCount, rentalCount] = await Promise.all([
      db.companySettings.findFirst(),
      db.getaroundAccount.count({ where: { isActive: true } }),
      db.vehicle.count({ where: { isActive: true } }),
      db.user.count({ where: { isActive: true, role: { not: 'third_party_owner' } } }),
      db.messageSequence.count({ where: { isActive: true } }),
      db.rental.count(),
    ]);

    const notifSettings = (settings?.notificationSettings ?? {}) as Record<string, unknown>;
    const dismissed = Boolean(notifSettings.onboardingDismissed);

    const steps = [
      {
        id: 'company_settings',
        label: 'Personnaliser votre espace',
        description: 'Logo ou couleur personnalisée dans les Paramètres',
        link: '/settings',
        completed: Boolean(settings?.logoUrl) || (settings?.primaryColor ?? '#01696e') !== '#01696e',
      },
      {
        id: 'getaround_connected',
        label: 'Connecter votre compte Getaround',
        description: 'Ajoutez votre clé API Getaround pour synchroniser votre flotte',
        link: '/settings#getaround',
        completed: accountCount > 0,
      },
      {
        id: 'vehicles_synced',
        label: 'Synchroniser votre flotte',
        description: 'Au moins un véhicule importé depuis Getaround ou créé manuellement',
        link: '/vehicles',
        completed: vehicleCount > 0,
      },
      {
        id: 'team_invited',
        label: 'Inviter votre équipe',
        description: 'Invitez au moins un collaborateur (exploitation, comptable, car keeper…)',
        link: '/users',
        completed: userCount >= 1,
      },
      {
        id: 'sequences_configured',
        label: 'Configurer une séquence automatique',
        description: 'Automatisez vos messages conducteurs (confirmation de réservation, etc.)',
        link: '/sequences',
        completed: sequenceCount > 0,
      },
      {
        id: 'first_rental',
        label: 'Première location synchronisée',
        description: 'Vos locations Getaround apparaissent dans l\'application',
        link: '/rentals',
        completed: rentalCount > 0,
      },
    ];

    const completedCount = steps.filter(s => s.completed).length;
    const progressPercent = Math.round((completedCount / steps.length) * 100);
    const allDone = completedCount === steps.length;

    res.json({
      steps,
      completedCount,
      totalCount: steps.length,
      progressPercent,
      allDone,
      dismissed,
    });
  } catch (err: unknown) { next(err); }
});

// GET /api/v1/onboarding/wizard-status
router.get('/wizard-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const [settings, accountCount, vehicleCount, rentalCount] = await Promise.all([
      db.companySettings.findFirst(),
      db.getaroundAccount.count({ where: { isActive: true } }),
      db.vehicle.count({ where: { isActive: true } }),
      db.rental.count(),
    ]);

    const checks = [
      { id: 'company_info', label: 'Informations société', completed: Boolean(settings) },
      { id: 'api_connected', label: 'Clé API Getaround', completed: accountCount > 0 },
      { id: 'fleet_synced', label: 'Flotte synchronisée', completed: vehicleCount > 0 },
      { id: 'messaging_prefs', label: 'Préférences messagerie', completed: Boolean(settings?.aiName) },
      { id: 'first_rental', label: 'Première location', completed: rentalCount > 0 },
    ];

    const completedCount = checks.filter(c => c.completed).length;
    res.json({ checks, completedCount, totalCount: checks.length });
  } catch (err: unknown) { next(err); }
});

// PATCH /api/v1/onboarding/company-info
router.patch('/company-info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      siret: z.string().optional(),
      managerName: z.string().optional(),
      phone: z.string().optional(),
      contactEmail: z.string().email().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const tenantSlug = req.auth?.tenantSlug;
    if (tenantSlug) {
      const master = getMasterClient();
      const data: Record<string, unknown> = {};
      if (body.data.siret !== undefined) data.siret = body.data.siret;
      if (body.data.managerName !== undefined) data.managerName = body.data.managerName;
      if (body.data.phone !== undefined) data.phone = body.data.phone;
      if (body.data.contactEmail !== undefined) data.contactEmail = body.data.contactEmail;
      if (body.data.address !== undefined) data.address = body.data.address;
      if (body.data.city !== undefined) data.city = body.data.city;
      if (body.data.postalCode !== undefined) data.postalCode = body.data.postalCode;
      if (Object.keys(data).length > 0) {
        await master.company.update({ where: { slug: tenantSlug }, data });
      }
    }

    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// PATCH /api/v1/onboarding/messaging-prefs
router.patch('/messaging-prefs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      tone: z.string().optional(),
      assistantName: z.string().optional(),
      defaultMode: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Données invalides' }); return; }

    const db = getTenantClient(req.tenantDbUrl!);
    const settings = await db.companySettings.findFirst();
    const data: Record<string, unknown> = {};
    if (body.data.tone !== undefined) data.aiTone = body.data.tone;
    if (body.data.assistantName !== undefined) data.aiName = body.data.assistantName;
    if (body.data.defaultMode !== undefined) data.aiModeGeneral = body.data.defaultMode === 'auto' ? 'approval' : body.data.defaultMode === 'manuel' ? 'manual' : 'approval';

    if (settings) {
      await db.companySettings.update({ where: { id: settings.id }, data });
    } else {
      await db.companySettings.create({ data: {} });
      const newSettings = await db.companySettings.findFirst();
      if (newSettings && Object.keys(data).length > 0) {
        await db.companySettings.update({ where: { id: newSettings.id }, data });
      }
    }

    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/onboarding/test-api-key
router.post('/test-api-key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ apiKey: z.string().min(1) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'apiKey requis' }); return; }

    try {
      const { createGetaroundClient } = await import('../getaround-sync/getaround-api');
      const client = createGetaroundClient(body.data.apiKey);
      await client.getCars();
      res.json({ success: true, valid: true });
    } catch {
      res.json({ success: false, valid: false, error: 'Clé API invalide ou connexion impossible' });
    }
  } catch (err: unknown) { next(err); }
});

// PATCH /api/v1/onboarding/complete
router.patch('/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantSlug = req.auth?.tenantSlug;
    if (tenantSlug) {
      const master = getMasterClient();
      await master.company.update({ where: { slug: tenantSlug }, data: { onboardingCompleted: true } });
    }
    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

// POST /api/v1/onboarding/dismiss — masquer définitivement le guide (stocké en JSON settings)
router.post('/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    let settings = await db.companySettings.findFirst();

    const currentNotifSettings = (settings?.notificationSettings ?? {}) as Record<string, unknown>;

    if (settings) {
      await db.companySettings.update({
        where: { id: settings.id },
        data: { notificationSettings: { ...currentNotifSettings, onboardingDismissed: true } },
      });
    } else {
      await db.companySettings.create({
        data: { notificationSettings: { onboardingDismissed: true } },
      });
    }

    res.json({ success: true });
  } catch (err: unknown) { next(err); }
});

export default router;
