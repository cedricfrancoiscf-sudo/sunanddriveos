import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes' },
});

const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez dans 1 heure' },
});

const icalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes iCal' },
});
import authRoutes from './modules/auth/auth.routes';
import vehiclesRoutes from './modules/vehicles/vehicles.routes';
import rentalsRoutes from './modules/rentals/rentals.routes';
import messagesRoutes from './modules/messages/messages.routes';
import aiRoutes from './modules/ai/ai.routes';
import sequencesRoutes from './modules/sequences/sequences.routes';
import maintenanceRoutes from './modules/maintenance/maintenance.routes';
import technicalControlRoutes from './modules/technical-control/technical-control.routes';
import vehicleChecksRoutes from './modules/vehicle-checks/vehicle-checks.routes';
import documentsRoutes from './modules/documents/documents.routes';
import planningRoutes from './modules/planning/planning.routes';
import usersRoutes from './modules/users/users.routes';
import settingsRoutes from './modules/settings/settings.routes';
import getaroundSyncRoutes from './modules/getaround-sync/getaround-sync.routes';
import accessoriesRoutes from './modules/accessories/accessories.routes';
import exportsRoutes from './modules/exports/exports.routes';
import incidentsRoutes from './modules/incidents/incidents.routes';
import carSeatRequestsRoutes from './modules/car-seat-requests/car-seat-requests.routes';
import carSeatsRoutes from './modules/car-seats/car-seats.routes';
import accessoryReservationsRoutes from './modules/accessory-reservations/accessory-reservations.routes';
import icalRoutes from './modules/ical/ical.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import blockingRoutes from './modules/blocking/blocking.routes';
import scoringRoutes from './modules/scoring/scoring.routes';
import thirdPartyOwnersRoutes from './modules/third-party-owners/third-party-owners.routes';
import superAdminRoutes from './modules/tenants/tenants.routes';
import onboardingRoutes from './modules/onboarding/onboarding.routes';
import vehicleCarkeepersRoutes from './modules/vehicles/vehicle-carkeepers.routes';
import vehicleCostsRoutes from './modules/vehicles/vehicle-costs.routes';
import renterProfileRoutes from './modules/rentals/renter-profile.routes';
import renterBlacklistRoutes from './modules/blocking/renter-blacklist.routes';
import getaroundWebhooksRoutes from './modules/getaround-sync/getaround-webhooks.routes';
import syncStatusRoutes from './modules/getaround-sync/sync-status.routes';
import tenantEventsRoutes from './modules/tenant-events/tenant-events.routes';
import feedbackRoutes from './modules/feedback/feedback.routes';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);

  // Sécurité HTTP — en-têtes de protection
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // CORS — autorise uniquement le frontend configuré
  app.use(
    cors({
      origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
    }),
  );

  // Webhook Getaround — raw body avant le parser JSON global (pour signature verification future)
  app.use('/api/v1/webhooks/getaround', express.raw({ type: '*/*' }), getaroundWebhooksRoutes);

  // Parsing requêtes
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Logs HTTP — désactivés en production pour limiter le bruit
  if (process.env.NODE_ENV !== 'production') {
    app.use(morgan('dev'));
  }

  // Servir les fichiers uploadés (photos véhicules, documents)
  app.use(
    '/uploads',
    express.static(path.join(process.cwd(), 'uploads')),
  );

  // Rate limiters sur routes publiques sensibles
  app.use('/api/v1/auth/login', loginLimiter);
  app.use('/api/v1/users/accept-invitation', inviteLimiter);
  app.use('/ical', icalLimiter);

  // Routes auth — login, me, superadmin
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/vehicles', vehiclesRoutes);
  app.use('/api/v1/vehicles/:vehicleId/carkeepers', vehicleCarkeepersRoutes);
  app.use('/api/v1/vehicles/:vehicleId/costs', vehicleCostsRoutes);
  // renter-profile AVANT rentals pour éviter conflit /:id
  app.use('/api/v1/rentals', renterProfileRoutes);
  app.use('/api/v1/rentals', rentalsRoutes);
  app.use('/api/v1/messages', messagesRoutes);
  app.use('/api/v1/ai', aiRoutes);
  app.use('/api/v1/sequences', sequencesRoutes);
  app.use('/api/v1/maintenance', maintenanceRoutes);
  app.use('/api/v1/technical-control', technicalControlRoutes);
  app.use('/api/v1/vehicle-checks', vehicleChecksRoutes);
  app.use('/api/v1/documents', documentsRoutes);
  app.use('/api/v1/planning', planningRoutes);
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1/settings', settingsRoutes);
  app.use('/api/v1/getaround-sync', getaroundSyncRoutes);
  app.use('/api/v1/accessories', accessoriesRoutes);
  app.use('/api/v1/exports', exportsRoutes);
  app.use('/api/v1/incidents', incidentsRoutes);
  app.use('/api/v1/car-seat-requests', carSeatRequestsRoutes);
  app.use('/api/v1/car-seats', carSeatsRoutes);
  app.use('/api/v1/accessory-reservations', accessoryReservationsRoutes);
  app.use('/api/v1/notifications', notificationsRoutes);
  app.use('/api/v1/blockings', blockingRoutes);
  app.use('/api/v1/scoring', scoringRoutes);
  app.use('/api/v1/third-party-owners', thirdPartyOwnersRoutes);
  app.use('/api/v1/superadmin', superAdminRoutes);
  app.use('/api/v1/onboarding', onboardingRoutes);
  app.use('/api/v1/blacklist', renterBlacklistRoutes);
  app.use('/api/v1/tenant-events', tenantEventsRoutes);
  app.use('/api/v1/feedback', feedbackRoutes);
  app.use('/api/v1/sync', syncStatusRoutes);
  // Route publique iCal — pas de JWT, compatible abonnement calendriers
  app.use('/ical', icalRoutes);

  // Route santé — vérifie que l'API répond
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'sunanddriveos-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  });

  // 404 — route non trouvée
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Route non trouvée' });
  });

  // Gestionnaire d'erreurs global — toujours en dernier
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Erreur API]', err.message, err.stack);
    const status = 'status' in err ? (err as { status: number }).status : 500;
    const isClientError = status >= 400 && status < 500;
    res.status(status).json({
      error: isClientError || process.env.NODE_ENV !== 'production' ? err.message : 'Erreur interne',
    });
  });

  return app;
}
