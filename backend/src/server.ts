// Point d'entrée du serveur Node.js
import 'dotenv/config';

// Vérifications fatales des variables d'environnement — avant toute initialisation
if (!process.env.JWT_SECRET) throw new Error('FATAL: JWT_SECRET non défini');
if (!process.env.DATABASE_MASTER_URL) throw new Error('FATAL: DATABASE_MASTER_URL non défini');
if (process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) throw new Error('FATAL: DB_PASSWORD requis en production');

import cron from 'node-cron';
import { createApp } from './app';
import { disconnectAll, getMasterClient, getTenantClient } from './prisma/client';
import { executePendingSequences } from './modules/sequences/sequences.service';
import { syncAllAccounts } from './modules/getaround-sync/getaround-sync.service';
import { notifyMileageAnomalies } from './modules/ai/ai.service';
import { sendEmail } from './utils/mailer';

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const app = createApp();

// Verrous anti-chevauchement des crons
let isSequenceRunning = false;
let isSyncRunning = false;
let isMorningSummaryRunning = false;
let isMileageRunning = false;
let isUnresponsiveRunning = false;

const server = app.listen(PORT, () => {
  console.log(`[SunanddriveOS] Backend démarré — port ${PORT}`);
  console.log(`[SunanddriveOS] Environnement : ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`[SunanddriveOS] Health : http://localhost:${PORT}/api/v1/health`);
});

// Planificateur de séquences — s'exécute toutes les minutes pour tous les tenants actifs
async function runSequenceScheduler(): Promise<void> {
  if (isSequenceRunning) { console.log('[Séquences] Déjà en cours, skip'); return; }
  isSequenceRunning = true;
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { tenantDbUrl: true, slug: true },
    });
    for (const company of companies) {
      const db = getTenantClient(company.tenantDbUrl);
      const result = await executePendingSequences(db);
      if (result.executed > 0) {
        console.log(`[Séquences] ${company.slug} : ${result.executed}/${result.total} message(s) créé(s)`);
      }
    }
  } catch (err: unknown) {
    console.error('[Séquences] Erreur planificateur :', err);
  } finally {
    isSequenceRunning = false;
  }
}

// Synchronisation Getaround — s'exécute toutes les heures pour tous les tenants actifs
async function runGetaroundSyncForAllTenants(): Promise<void> {
  if (isSyncRunning) { console.log('[GetaroundSync] Déjà en cours, skip'); return; }
  isSyncRunning = true;
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { tenantDbUrl: true, slug: true },
    });
    for (const company of companies) {
      try {
        const db = getTenantClient(company.tenantDbUrl);
        const results = await syncAllAccounts(db);
        const created = results.reduce((s, r) => s + r.vehicles.created + r.rentals.created, 0);
        const updated = results.reduce((s, r) => s + r.vehicles.updated + r.rentals.updated, 0);
        console.log(`[GetaroundSync] ${company.slug} : ${created} créé(s), ${updated} mis à jour`);
      } catch (err: unknown) {
        console.error(`[GetaroundSync] Erreur tenant ${company.slug} :`, err);
      }
    }
  } catch (err: unknown) {
    console.error('[GetaroundSync] Erreur planificateur :', err);
  } finally {
    isSyncRunning = false;
  }
}

// Démarre après 10s pour laisser le temps à la DB de s'initialiser
setTimeout(() => {
  void runSequenceScheduler();
  setInterval(() => void runSequenceScheduler(), 60_000);
}, 10_000);

// Premier passage Getaround après 120s, puis toutes les heures
setTimeout(() => void runGetaroundSyncForAllTenants(), 120_000);
cron.schedule('0 * * * *', () => void runGetaroundSyncForAllTenants());

// ─── 4.6 — Résumé matinal (8h chaque jour) ────────────────────────────────

async function runMorningSummary(): Promise<void> {
  if (isMorningSummaryRunning) { console.log('[MorningSummary] Déjà en cours, skip'); return; }
  isMorningSummaryRunning = true;
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { tenantDbUrl: true, slug: true, name: true },
    });

    for (const company of companies) {
      try {
        const db = getTenantClient(company.tenantDbUrl);
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart.getTime() + 86_400_000);
        const cutoff12h = new Date(now.getTime() - 12 * 3_600_000);

        const [departures, returns, admins, unanswered] = await Promise.all([
          db.rental.findMany({ where: { startAt: { gte: todayStart, lt: todayEnd } }, select: { driverName: true, vehicle: { select: { make: true, model: true, licensePlate: true } } } }),
          db.rental.findMany({ where: { endAt: { gte: todayStart, lt: todayEnd } }, select: { driverName: true, vehicle: { select: { make: true, model: true, licensePlate: true } } } }),
          db.user.findMany({ where: { role: 'admin', isActive: true }, select: { email: true, name: true } }),
          db.rental.findMany({
            where: { status: { in: ['booked', 'active'] }, messages: { none: { direction: 'inbound', createdAt: { gte: cutoff12h } } } },
            select: { driverName: true },
            take: 10,
          }),
        ]);

        const lines: string[] = [];
        lines.push(`<h2>☀️ Résumé du ${todayStart.toLocaleDateString('fr-FR')} — ${company.name}</h2>`);
        lines.push(`<h3>Départs aujourd'hui (${departures.length})</h3>`);
        departures.forEach(r => lines.push(`<li>${r.driverName} · ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.licensePlate})</li>`));
        lines.push(`<h3>Retours aujourd'hui (${returns.length})</h3>`);
        returns.forEach(r => lines.push(`<li>${r.driverName} · ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.licensePlate})</li>`));
        if (unanswered.length > 0) {
          lines.push(`<h3>⚠️ Messages sans réponse depuis +12h (${unanswered.length})</h3>`);
          unanswered.forEach(r => lines.push(`<li>${r.driverName}</li>`));
        }

        const html = `<ul>${lines.join('')}</ul>`;
        const summary = lines.map(l => l.replace(/<[^>]+>/g, '')).join('\n');

        if (admins.length === 0) {
          console.log(`[MorningSummary] ${company.slug} :\n${summary}`);
          continue;
        }

        for (const admin of admins) {
          if (process.env.SMTP_USER) {
            await sendEmail({ to: admin.email, subject: `☀️ Résumé matinal — ${company.name}`, html });
          } else {
            console.log(`[MorningSummary] ${company.slug} → ${admin.email} :\n${summary}`);
          }
        }
      } catch (err: unknown) {
        console.error(`[MorningSummary] Erreur tenant ${company.slug} :`, err);
      }
    }
  } catch (err: unknown) {
    console.error('[MorningSummary] Erreur :', err);
  } finally {
    isMorningSummaryRunning = false;
  }
}

cron.schedule('0 8 * * *', () => void runMorningSummary());

// ─── 4.7 — Alerte locataire non répondant (dans le cron horaire) ──────────

async function checkUnresponsiveRenters(): Promise<void> {
  if (isUnresponsiveRunning) { console.log('[UnresponsiveRenter] Déjà en cours, skip'); return; }
  isUnresponsiveRunning = true;
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { tenantDbUrl: true, slug: true },
    });

    for (const company of companies) {
      try {
        const db = getTenantClient(company.tenantDbUrl);
        const now = new Date();
        const in2h = new Date(now.getTime() + 2 * 3_600_000);
        const cutoff2h = new Date(now.getTime() - 2 * 3_600_000);

        // Locations dont le départ est dans moins de 2h
        const upcoming = await db.rental.findMany({
          where: { status: 'booked', startAt: { gte: now, lte: in2h } },
          include: {
            vehicle: { select: { make: true, model: true, licensePlate: true } },
            messages: { where: { direction: 'inbound' }, orderBy: { createdAt: 'desc' }, take: 1 },
          },
        });

        const admins = upcoming.length > 0
          ? await db.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } })
          : [];

        for (const rental of upcoming) {
          const lastInbound = rental.messages[0];
          const isUnresponsive = !lastInbound || new Date(lastInbound.createdAt) < cutoff2h;
          if (!isUnresponsive) continue;

          const minUntil = Math.round((new Date(rental.startAt).getTime() - now.getTime()) / 60_000);
          const vehicleLabel = `${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})`;

          for (const admin of admins) {
            const existing = await db.notification.findFirst({
              where: { userId: admin.id, type: 'unresponsive_renter', relatedEntityId: rental.id },
            });
            if (existing) continue;

            await db.notification.create({
              data: {
                userId: admin.id,
                type: 'unresponsive_renter',
                title: `Locataire non répondant — ${rental.driverName}`,
                body: `${vehicleLabel} — remise dans ${minUntil} min`,
                relatedEntityType: 'rental',
                relatedEntityId: rental.id,
              },
            });
          }
        }
      } catch (err: unknown) {
        console.error(`[UnresponsiveRenter] Erreur tenant ${company.slug} :`, err);
      }
    }
  } catch (err: unknown) {
    console.error('[UnresponsiveRenter] Erreur :', err);
  } finally {
    isUnresponsiveRunning = false;
  }
}

// ─── 4.4 — Anomalies km (dans le cron horaire) ────────────────────────────

async function runMileageAnomalyDetection(): Promise<void> {
  if (isMileageRunning) { console.log('[MileageAnomaly] Déjà en cours, skip'); return; }
  isMileageRunning = true;
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { tenantDbUrl: true, slug: true },
    });
    for (const company of companies) {
      try {
        const db = getTenantClient(company.tenantDbUrl);
        await notifyMileageAnomalies(db);
      } catch (err: unknown) {
        console.error(`[MileageAnomaly] Erreur tenant ${company.slug} :`, err);
      }
    }
  } catch (err: unknown) {
    console.error('[MileageAnomaly] Erreur :', err);
  } finally {
    isMileageRunning = false;
  }
}

// Brancher anomalies km + locataires non répondants dans le cron horaire
cron.schedule('30 * * * *', () => {
  void runMileageAnomalyDetection();
  void checkUnresponsiveRenters();
});

// Fermeture gracieuse — libère connexions Prisma proprement
const shutdown = async (signal: string): Promise<void> => {
  console.log(`[SunanddriveOS] Signal ${signal} reçu — arrêt en cours...`);
  server.close(async () => {
    await disconnectAll();
    console.log('[SunanddriveOS] Arrêt propre');
    process.exit(0);
  });
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
