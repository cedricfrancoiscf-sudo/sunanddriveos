import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

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
