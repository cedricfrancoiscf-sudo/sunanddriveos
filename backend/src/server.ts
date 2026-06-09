// Point d'entrée du serveur Node.js
import 'dotenv/config';

// Vérifications fatales des variables d'environnement — avant toute initialisation
if (!process.env.JWT_SECRET) throw new Error('FATAL: JWT_SECRET non défini');
if (!process.env.DATABASE_MASTER_URL) throw new Error('FATAL: DATABASE_MASTER_URL non défini');
if (process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) throw new Error('FATAL: DB_PASSWORD requis en production');

import cron from 'node-cron';
import { createApp } from './app';
import { disconnectAll, getMasterClient, getTenantClient } from './prisma/client';
import { executePendingSequences, cleanupObsoleteSequences } from './modules/sequences/sequences.service';
import { syncAllAccounts, syncRecentWindowForAccount, recalculateHistoricalPayouts, syncUnavailabilitiesForTenant } from './modules/getaround-sync/getaround-sync.service';
import { generateCeoReportAsync } from './modules/intelligence/report.routes';
import { analyzeAndProcessMessage, type RentalForMessaging } from './modules/messages/messaging.service';
import { decrypt } from './utils/crypto';
import { createGetaroundClient } from './modules/getaround-sync/getaround-api';
import { registerSyncTrigger } from './modules/getaround-sync/getaround-webhooks.routes';
import { notifyMileageAnomalies } from './modules/ai/ai.service';
import { getUpcomingMaintenances } from './modules/maintenance/maintenance.service';
import { sendEmail } from './utils/mailer';
import { trialExpiryEmailHtml } from './modules/email/templates';
import { sendTelegramMessage, getTelegramChatId } from './utils/telegram';

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const app = createApp();

// Verrous anti-chevauchement des crons
let isSequenceRunning = false;
let isSyncRunning = false;
let isMorningSummaryRunning = false;
let isMileageRunning = false;
let isUnresponsiveRunning = false;
let isProactiveMessagingRunning = false;
let isRebalayageRunning = false;

registerSyncTrigger(() => runGetaroundSyncForAllTenants());

const server = app.listen(PORT, () => {
  console.log(`[SunanddriveOS] Backend démarré — port ${PORT}`);
  console.log(`[SunanddriveOS] Environnement : ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`[SunanddriveOS] Health : http://localhost:${PORT}/api/v1/health`);

  // Nettoyage au démarrage : annuler les séquences dont la location est terminée
  void (async () => {
    try {
      const master = getMasterClient();
      const companies = await master.company.findMany({ where: { isActive: true }, select: { tenantDbUrl: true } });
      for (const c of companies) {
        const db = getTenantClient(c.tenantDbUrl);
        await cleanupObsoleteSequences(db);
      }
    } catch (e) { console.error('[Séquences] Erreur cleanup démarrage:', e); }
  })();
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

      const sendToGetaround = async (rentalGetaroundId: number, content: string): Promise<void> => {
        const rental = await db.rental.findFirst({
          where: { getaroundId: String(rentalGetaroundId) },
          include: { vehicle: { select: { getaroundAccountId: true } } },
        });
        const accountId = rental?.vehicle.getaroundAccountId;
        if (!accountId) throw new Error(`Compte Getaround introuvable pour location ${rentalGetaroundId}`);
        const account = await db.getaroundAccount.findUnique({ where: { id: accountId } });
        if (!account) throw new Error(`Compte Getaround ${accountId} introuvable`);
        const apiKey = decrypt(account.apiKeyHash);
        await createGetaroundClient(apiKey).sendMessage(rentalGetaroundId, content);
      };

      const result = await executePendingSequences(db, sendToGetaround);
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

const TENANT_SYNC_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// Synchronisation Getaround — s'exécute toutes les heures pour tous les tenants actifs
async function runGetaroundSyncForAllTenants(): Promise<void> {
  if (isSyncRunning) { console.log('[GetaroundSync] Déjà en cours, skip'); return; }
  isSyncRunning = true;
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { id: true, tenantDbUrl: true, slug: true },
    });
    for (const company of companies) {
      console.log(`[Sync] Tenant ${company.slug} : début`);
      const db = getTenantClient(company.tenantDbUrl);
      try {
        const results = await Promise.race([
          syncAllAccounts(db, company.slug),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout sync tenant')), TENANT_SYNC_TIMEOUT)
          ),
        ]);
        const created = results.reduce((s, r) => s + r.vehicles.created + r.rentals.created, 0);
        const updated = results.reduce((s, r) => s + r.vehicles.updated + r.rentals.updated, 0);
        console.log(`[Sync] Tenant ${company.slug} : ${created} créé(s), ${updated} mis à jour`);
        // Nettoyer les séquences obsolètes après chaque sync réussie
        void cleanupObsoleteSequences(db).catch(e => console.error('[Séquences] Erreur cleanup post-sync:', e));

        // Rattrapage : locations dont endAt est passé mais status toujours 'active'
        try {
          const expired = await db.rental.updateMany({
            where: { status: 'active', endAt: { lt: new Date() } },
            data: { status: 'completed' },
          });
          if (expired.count > 0) {
            console.log(`[Cron] ${company.slug} : ${expired.count} location(s) expirée(s) passées en completed`);
          }
        } catch (e) { console.error(`[Cron] Erreur rattrapage locations expirées ${company.slug}:`, e); }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Sync] Tenant ${company.slug} : erreur — ${message}`);
        // Continuer avec le tenant suivant
      }

      // Section 7 — détection erreurs répétées (syncStatus='error' sur un compte depuis > 2h)
      try {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const errorAccounts = await db.getaroundAccount.findMany({
          where: { syncStatus: 'error', isActive: true, updatedAt: { lt: twoHoursAgo } },
          select: { id: true },
        });
        if (errorAccounts.length > 0) {
          const existing = await master.tenantEvent.findFirst({
            where: {
              companyId: company.id,
              action: 'sync_error_repeated',
              occurredAt: { gte: twoHoursAgo },
            },
          });
          if (!existing) {
            await master.tenantEvent.create({
              data: { companyId: company.id, module: 'sync', action: 'sync_error_repeated' },
            });
            console.error(`[SuperAdmin] Tenant ${company.slug} en erreur depuis > 2h — intervention recommandée`);
          }
        }
      } catch (e) {
        console.error(`[SuperAdmin] Erreur vérification erreurs répétées ${company.slug}:`, e);
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

// Sync fenêtre glissante (cron horaire) — -2 mois à +3 mois, sans toucher lastSyncAt
let isRecentSyncRunning = false;

async function runRecentWindowSyncForAllTenants(): Promise<void> {
  if (isRecentSyncRunning) { console.log('[RecentSync] Déjà en cours, skip'); return; }
  isRecentSyncRunning = true;
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { tenantDbUrl: true, slug: true },
    });
    for (const company of companies) {
      const db = getTenantClient(company.tenantDbUrl);
      const accounts = await db.getaroundAccount.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      for (const account of accounts) {
        try {
          await syncRecentWindowForAccount(db, account.id, company.slug);
        } catch (err: unknown) {
          console.error(`[RecentSync] ${company.slug} compte ${account.id} :`, err instanceof Error ? err.message : err);
        }
      }
      // Rattrapage : active dont endAt est passé
      try {
        const expired = await db.rental.updateMany({
          where: { status: 'active', endAt: { lt: new Date() } },
          data: { status: 'completed' },
        });
        if (expired.count > 0) console.log(`[RecentSync] ${company.slug} : ${expired.count} expirée(s) → completed`);
      } catch (e) { console.error(`[RecentSync] Rattrapage ${company.slug}:`, e); }
      void cleanupObsoleteSequences(db).catch(e => console.error('[RecentSync] cleanup séquences:', e));
      try {
        await syncUnavailabilitiesForTenant(db, company.slug);
      } catch (e) { console.error(`[RecentSync] Unavailabilities ${company.slug}:`, e); }
    }
  } catch (err: unknown) {
    console.error('[RecentSync] Erreur générale :', err);
  } finally {
    isRecentSyncRunning = false;
  }
}

// Premier passage Getaround après 120s (fenêtre glissante), puis toutes les heures
setTimeout(() => void runRecentWindowSyncForAllTenants(), 120_000);
cron.schedule('0 * * * *', () => void runRecentWindowSyncForAllTenants());

// ─── Messagerie proactive (cron 30 min) ──────────────────────────────────────

async function runProactiveMessaging(): Promise<void> {
  if (isProactiveMessagingRunning) { console.log('[ProactiveMsg] Déjà en cours, skip'); return; }
  isProactiveMessagingRunning = true;
  console.log('[ProactiveMsg] Démarrage — recherche messages inbound...');
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { tenantDbUrl: true, slug: true },
    });
    for (const company of companies) {
      try {
        const db = getTenantClient(company.tenantDbUrl);
        const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
        const cutoff35m = new Date(Date.now() - 35 * 60_000);

        const accounts = await db.getaroundAccount.findMany({
          where: { isActive: true },
          select: { id: true, apiKeyHash: true },
        });
        const gaClients = new Map(accounts.map(a => [a.id, createGetaroundClient(decrypt(a.apiKeyHash))]));

        const newInbound = await db.message.findMany({
          where: {
            direction: 'inbound',
            createdAt: { gte: cutoff35m },
            rental: {
              OR: [
                { status: { in: ['active', 'booked'] } },
                { status: 'completed', endAt: { gte: sevenDaysAgo } },
              ],
            },
          },
          select: {
            id: true, content: true,
            rental: {
              select: {
                id: true, vehicleId: true, driverName: true,
                driverGetaroundId: true, getaroundId: true, startAt: true, endAt: true,
                vehicle: {
                  select: {
                    make: true, model: true, licensePlate: true,
                    parkingZone: true, deliveryPointName: true, getaroundAccountId: true,
                  },
                },
              },
            },
          },
        });

        let processed = 0;
        for (const msg of newInbound) {
          if (!msg.rental) continue;
          const accountId = msg.rental.vehicle.getaroundAccountId;
          if (!accountId) continue;
          const ga = gaClients.get(accountId);
          if (!ga) {
            console.warn('[Messaging] Pas de client Getaround pour account', accountId);
            continue;
          }
          try {
            const r = msg.rental;
            const rentalData: RentalForMessaging = {
              id: r.id, vehicleId: r.vehicleId, driverName: r.driverName,
              driverGetaroundId: r.driverGetaroundId, getaroundId: r.getaroundId, startAt: r.startAt, endAt: r.endAt,
              vehicle: { make: r.vehicle.make, model: r.vehicle.model, licensePlate: r.vehicle.licensePlate, parkingZone: r.vehicle.parkingZone, deliveryPointName: r.vehicle.deliveryPointName },
            };
            await analyzeAndProcessMessage({ id: msg.id, content: msg.content }, rentalData, db, ga);
            processed++;
          } catch (e) { console.error(`[ProactiveMsg] Erreur message ${msg.id}:`, e); }
        }
        if (processed > 0) {
          console.log(`[ProactiveMsg] ${company.slug} : ${processed} message(s) traité(s)`);
        } else {
          console.log(`[ProactiveMsg] ${company.slug} : 0 message à traiter`);
        }
      } catch (e) { console.error(`[ProactiveMsg] Erreur tenant ${company.slug}:`, e); }
    }
  } catch (e) { console.error('[ProactiveMsg] Erreur générale:', e); }
  finally { isProactiveMessagingRunning = false; }
}

cron.schedule('*/30 * * * *', () => void runProactiveMessaging());

// ─── Rebalayage 7h — messages inbound sans réponse ────────────────────────────

async function runMorningRebalayage(): Promise<void> {
  if (isRebalayageRunning) { console.log('[Rebalayage] Déjà en cours, skip'); return; }
  isRebalayageRunning = true;
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { tenantDbUrl: true, slug: true },
    });
    for (const company of companies) {
      try {
        const db = getTenantClient(company.tenantDbUrl);
        const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
        const cutoff30m = new Date(Date.now() - 30 * 60_000);

        const accounts = await db.getaroundAccount.findMany({
          where: { isActive: true },
          select: { id: true, apiKeyHash: true },
        });
        const gaClients = new Map(accounts.map(a => [a.id, createGetaroundClient(decrypt(a.apiKeyHash))]));

        const rentals = await db.rental.findMany({
          where: {
            OR: [
              { status: { in: ['active', 'booked'] } },
              { status: 'completed', endAt: { gte: sevenDaysAgo } },
            ],
          },
          select: {
            id: true, vehicleId: true, driverName: true,
            driverGetaroundId: true, getaroundId: true, startAt: true, endAt: true,
            vehicle: {
              select: {
                make: true, model: true, licensePlate: true,
                parkingZone: true, deliveryPointName: true, getaroundAccountId: true,
              },
            },
            messages: {
              orderBy: { createdAt: 'asc' },
              select: { id: true, direction: true, content: true, createdAt: true },
            },
          },
        });

        let locations = 0, msgs = 0;
        for (const rental of rentals) {
          const ga = rental.vehicle.getaroundAccountId
            ? gaClients.get(rental.vehicle.getaroundAccountId)
            : null;
          if (!ga) continue;

          const inboundNoReply = rental.messages.filter(m => {
            if (m.direction !== 'inbound') return false;
            if (m.createdAt >= cutoff30m) return false; // créé il y a < 30 min → skip
            return !rental.messages.some(
              om => om.direction === 'outbound' && om.createdAt > m.createdAt,
            );
          });
          if (inboundNoReply.length === 0) continue;
          locations++;

          const rentalData: RentalForMessaging = {
            id: rental.id, vehicleId: rental.vehicleId, driverName: rental.driverName,
            driverGetaroundId: rental.driverGetaroundId, getaroundId: rental.getaroundId, startAt: rental.startAt, endAt: rental.endAt,
            vehicle: { make: rental.vehicle.make, model: rental.vehicle.model, licensePlate: rental.vehicle.licensePlate, parkingZone: rental.vehicle.parkingZone, deliveryPointName: rental.vehicle.deliveryPointName },
          };
          for (const msg of inboundNoReply) {
            try {
              await analyzeAndProcessMessage({ id: msg.id, content: msg.content }, rentalData, db, ga);
              msgs++;
            } catch (e) { console.error(`[Rebalayage] Erreur message ${msg.id}:`, e); }
          }
        }
        console.log(`[Cron 7h] ${company.slug} Rebalayage : ${locations} location(s), ${msgs} message(s) traité(s)`);
      } catch (e) { console.error(`[Rebalayage] Erreur tenant ${company.slug}:`, e); }
    }
  } catch (e) { console.error('[Rebalayage] Erreur générale:', e); }
  finally { isRebalayageRunning = false; }
}

cron.schedule('0 7 * * *', () => void runMorningRebalayage());

// ─── Résumé matinal enrichi (8h chaque jour) ─────────────────────────────────

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
        const in24h = new Date(now.getTime() + 86_400_000);
        const in30d = new Date(now.getTime() + 30 * 86_400_000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
        const cutoff12h = new Date(now.getTime() - 12 * 3_600_000);
        const cutoff2h = new Date(now.getTime() - 2 * 3_600_000);
        const dateLabel = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

        const [
          departures, returns, carSeatRequests,
          expiringCT, expiringMaint,
          recipients,
          anomalies,
        ] = await Promise.all([
          db.rental.findMany({
            where: { startAt: { gte: now, lte: in24h }, status: { in: ['booked', 'active'] } },
            select: {
              driverName: true, startAt: true,
              vehicle: { select: { make: true, model: true, licensePlate: true, parkingZone: true } },
            },
            orderBy: { startAt: 'asc' },
          }),
          db.rental.findMany({
            where: { endAt: { gte: now, lte: in24h }, status: { in: ['active', 'completed'] } },
            select: {
              driverName: true, endAt: true,
              vehicle: { select: { make: true, model: true, licensePlate: true, parkingZone: true } },
            },
            orderBy: { endAt: 'asc' },
          }),
          db.carSeatRequest.findMany({
            where: {
              rental: { status: { in: ['booked', 'active'] } },
            },
            select: {
              id: true,
              rental: {
                select: {
                  driverName: true, startAt: true,
                  vehicle: { select: { make: true, model: true, licensePlate: true, parkingZone: true } },
                },
              },
            },
          }),
          db.technicalControl.findMany({
            where: { expiryAt: { gte: now, lte: in30d } },
            select: { expiryAt: true, vehicle: { select: { make: true, model: true, licensePlate: true } } },
            orderBy: { expiryAt: 'asc' },
          }),
          getUpcomingMaintenances(db),
          db.user.findMany({
            where: { role: { in: ['admin', 'exploitant'] }, isActive: true },
            select: { email: true, name: true },
          }),
          // Locations booked dont le startAt est dépassé > 2h (sans check-in)
          db.rental.findMany({
            where: { status: 'booked', startAt: { lt: cutoff2h } },
            select: {
              driverName: true, startAt: true,
              vehicle: { select: { make: true, model: true, licensePlate: true } },
            },
          }),
        ]);

        // CA du jour
        const todayRentals = await db.rental.findMany({
          where: {
            status: { in: ['active', 'completed'] },
            OR: [{ startAt: { lte: in24h, gte: now } }, { endAt: { lte: in24h, gte: now } }],
          },
          select: { ownerPayout: true, grossRevenue: true, status: true },
        });
        const caEncaisse = todayRentals.filter(r => r.ownerPayout != null).reduce((s, r) => s + (r.ownerPayout ?? 0), 0);
        const caPrevisionnel = todayRentals.filter(r => r.ownerPayout == null).reduce((s, r) => s + (r.grossRevenue ?? 0), 0);

        // Messages en attente > 12h
        const unansweredRentalIds = (await db.rental.findMany({
          where: {
            status: { in: ['booked', 'active'] },
            messages: {
              some: { direction: 'inbound', createdAt: { lt: cutoff12h } },
              none: { direction: 'outbound', status: { in: ['approved', 'sent'] } },
            },
          },
          select: { id: true },
        })).map(r => r.id);
        const unansweredMessages = unansweredRentalIds.length > 0
          ? await db.message.findMany({
              where: { direction: 'inbound', createdAt: { lt: cutoff12h }, rentalId: { in: unansweredRentalIds } },
              select: {
                content: true, createdAt: true,
                rental: { select: { driverName: true, vehicle: { select: { make: true, model: true, licensePlate: true } } } },
              },
              orderBy: { createdAt: 'asc' },
              distinct: ['rentalId'],
              take: 10,
            })
          : [];

        const fmt = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const fmtEur = (v: number) => v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
        const section = (icon: string, title: string, rows: string[], emptyMsg = 'Rien à signaler') =>
          `<div style="margin:16px 0"><h3 style="font-size:14px;font-weight:bold;margin:0 0 8px;color:#1e293b">${icon} ${title}</h3>${rows.length > 0 ? `<ul style="margin:0;padding-left:20px;color:#374151;font-size:13px">${rows.map(r => `<li style="margin:2px 0">${r}</li>`).join('')}</ul>` : `<p style="color:#94a3b8;font-size:13px;margin:0">${emptyMsg}</p>`}</div>`;

        const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#f8fafc">
<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
  <div style="background:#01696e;padding:20px 24px">
    <h1 style="color:#fff;font-size:18px;margin:0">☀️ Résumé du jour — ${company.name}</h1>
    <p style="color:#a7f3d0;font-size:12px;margin:4px 0 0">${dateLabel}</p>
  </div>
  <div style="padding:20px 24px">
    ${section('🚗', `Départs du jour (${departures.length})`, departures.map(r => `<b>${fmt(new Date(r.startAt))}</b> — ${r.driverName} · ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.licensePlate})${r.vehicle.parkingZone ? ` — ${r.vehicle.parkingZone}` : ''}`))}
    ${section('🔄', `Retours du jour (${returns.length})`, returns.map(r => `<b>${fmt(new Date(r.endAt))}</b> — ${r.driverName} · ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.licensePlate})${r.vehicle.parkingZone ? ` — ${r.vehicle.parkingZone}` : ''}`))}
    ${section('🪑', `Sièges auto à préparer (${carSeatRequests.length})`, carSeatRequests.filter(r => r.rental).map(r => `${r.rental!.driverName} · ${r.rental!.vehicle.make} ${r.rental!.vehicle.model} (${r.rental!.vehicle.licensePlate}) — départ ${new Date(r.rental!.startAt).toLocaleDateString('fr-FR')}`))}
    ${section('🔧', `CT / Entretiens dans 30 jours`, [
      ...expiringCT.map(c => `CT — ${c.vehicle.make} ${c.vehicle.model} (${c.vehicle.licensePlate}) — expire le ${new Date(c.expiryAt).toLocaleDateString('fr-FR')}`),
      ...expiringMaint.map(m => {
        const parts: string[] = [`Entretien ${m.type} — ${m.vehicle.make} ${m.vehicle.model} (${m.vehicle.licensePlate})`];
        if (m.nextServiceDate) {
          const diffDays = Math.ceil((new Date(m.nextServiceDate).getTime() - now.getTime()) / 86_400_000);
          parts.push(diffDays <= 0 ? `date dépassée (${new Date(m.nextServiceDate).toLocaleDateString('fr-FR')})` : `dans ${diffDays} j (${new Date(m.nextServiceDate).toLocaleDateString('fr-FR')})`);
        }
        if (m.nextServiceMileage != null && m.vehicle.currentMileage != null) {
          const remaining = m.nextServiceMileage - m.vehicle.currentMileage;
          parts.push(`dans ${remaining.toLocaleString('fr-FR')} km (actuel : ${m.vehicle.currentMileage.toLocaleString('fr-FR')} km)`);
        }
        return parts.join(' — ');
      }),
    ])}
    ${section('💬', `Messages en attente > 12h (${unansweredMessages.length})`, unansweredMessages.map(m => `${m.rental?.driverName ?? '?'} · ${m.rental?.vehicle.make} ${m.rental?.vehicle.model} — <i>${m.content.slice(0, 60)}…</i>`))}
    ${section('💶', 'CA du jour', [
      ...(caEncaisse > 0 ? [`Encaissé : <b>${fmtEur(caEncaisse)}</b>`] : []),
      ...(caPrevisionnel > 0 ? [`Prévisionnel : ${fmtEur(caPrevisionnel)}`] : []),
    ], 'Aucune location encaissée aujourd\'hui')}
    ${section('⚠️', `Anomalies (${anomalies.length})`, anomalies.map(r => `Départ prévu ${fmt(new Date(r.startAt))} non confirmé — ${r.driverName} · ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.licensePlate})`))}
  </div>
  <div style="background:#f1f5f9;padding:12px 24px;font-size:11px;color:#94a3b8">SunanddriveOS — rapport automatique quotidien</div>
</div></body></html>`;

        if (recipients.length === 0) {
          console.log(`[MorningSummary] ${company.slug} : aucun destinataire`);
          continue;
        }
        for (const r of recipients) {
          if (process.env.RESEND_API_KEY) {
            await sendEmail({
              from: 'appli@sunanddrive.com',
              to: r.email,
              subject: `☀️ Résumé du jour — Sun and Drive — ${now.toLocaleDateString('fr-FR')}`,
              html,
            });
          } else {
            console.log(`[MorningSummary] ${company.slug} → ${r.email} : ${departures.length} départs, ${returns.length} retours`);
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
          // Telegram — locataire non répondant (une seule fois, premier admin)
          if (admins.length > 0) {
            void (async () => {
              try {
                const chatId = await getTelegramChatId(db as never);
                if (chatId) {
                  await sendTelegramMessage(chatId,
                    `⚠️ <b>Locataire non répondant</b>\n${rental.driverName}\n${vehicleLabel}\nRemise dans ${minUntil} min`,
                  );
                }
              } catch (e) { console.error('[Telegram] Unresponsive:', e); }
            })();
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

// ─── 6 — Évaluations automatiques ────────────────────────────────────────────

let isAutoEvalRunning = false;

async function runAutoEvaluations(): Promise<void> {
  if (isAutoEvalRunning) { console.log('[AutoEval] Déjà en cours, skip'); return; }
  isAutoEvalRunning = true;
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
        const since24h = new Date(now.getTime() - 24 * 3_600_000);

        const pending = await db.rental.findMany({
          where: { status: 'completed', evaluationStatus: 'pending', endAt: { gte: since24h, lte: now } },
          select: {
            id: true, driverName: true,
            lateReturnFee: true, damageCompensation: true, gasRefillFee: true, driverMessFee: true,
            vehicle: { select: { make: true, model: true, licensePlate: true } },
          },
        });

        const admins = pending.length > 0
          ? await db.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } })
          : [];

        for (const rental of pending) {
          const noFees =
            (rental.lateReturnFee ?? 0) === 0 &&
            (rental.damageCompensation ?? 0) === 0 &&
            (rental.gasRefillFee ?? 0) === 0 &&
            (rental.driverMessFee ?? 0) === 0;

          const newStatus = noFees ? ('posted' as const) : ('blocked' as const);
          const vehicleLabel = `${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})`;

          await db.rental.update({ where: { id: rental.id }, data: { evaluationStatus: newStatus } });

          for (const admin of admins) {
            const existing = await db.notification.findFirst({
              where: { userId: admin.id, type: 'auto_evaluation', relatedEntityId: rental.id },
            });
            if (existing) continue;
            await db.notification.create({
              data: {
                userId: admin.id,
                type: 'auto_evaluation',
                title: noFees
                  ? `✅ Évaluation à poster sur Getaround pour ${rental.driverName} - ${vehicleLabel}`
                  : `⚠️ Évaluation bloquée pour ${rental.driverName} - frais supplémentaires détectés`,
                body: vehicleLabel,
                relatedEntityType: 'rental',
                relatedEntityId: rental.id,
              },
            });
          }
        }
      } catch (err: unknown) {
        console.error(`[AutoEval] Erreur tenant ${company.slug} :`, err);
      }
    }
  } catch (err: unknown) {
    console.error('[AutoEval] Erreur :', err);
  } finally {
    isAutoEvalRunning = false;
  }
}

// Brancher anomalies km + locataires non répondants dans le cron horaire
cron.schedule('30 * * * *', () => {
  void runMileageAnomalyDetection();
  void checkUnresponsiveRenters();
  void runAutoEvaluations();
});

// ─── Rappel mensuel saisie notes Getaround (le 25 de chaque mois) ────────────

async function runMonthlyRatingReminder(): Promise<void> {
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { tenantDbUrl: true, slug: true },
    });

    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    for (const company of companies) {
      try {
        const db = getTenantClient(company.tenantDbUrl);
        const [vehicles, admins] = await Promise.all([
          db.vehicle.findMany({
            where: { isActive: true },
            select: { id: true, make: true, model: true, licensePlate: true },
          }),
          db.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } }),
        ]);

        for (const vehicle of vehicles) {
          const existing = await db.vehicleRating.findUnique({
            where: { vehicleId_period: { vehicleId: vehicle.id, period: currentPeriod } },
          });
          if (existing) continue;

          for (const admin of admins) {
            const alreadyNotified = await db.notification.findFirst({
              where: { userId: admin.id, type: 'rating_reminder', relatedEntityId: vehicle.id },
            });
            if (alreadyNotified) continue;
            await db.notification.create({
              data: {
                userId: admin.id,
                type: 'rating_reminder',
                title: `📊 Pensez à mettre à jour la note Getaround — ${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})`,
                body: `Notes utilisées par l'IA pour améliorer ses suggestions qualité`,
                relatedEntityType: 'vehicle',
                relatedEntityId: vehicle.id,
              },
            });
          }
        }
      } catch (err: unknown) {
        console.error(`[RatingReminder] Erreur tenant ${company.slug} :`, err);
      }
    }
  } catch (err: unknown) {
    console.error('[RatingReminder] Erreur :', err);
  }
}

cron.schedule('0 9 25 * *', () => void runMonthlyRatingReminder());

// ─── Recalcul mensuel des payouts (le 5 de chaque mois à 6h) ─────────────────

cron.schedule('0 6 5 * *', () => {
  console.log('[Cron Mensuel] Recalcul payouts automatique');
  void (async () => {
    try {
      const master = getMasterClient();
      const companies = await master.company.findMany({
        where: { isActive: true },
        select: { tenantDbUrl: true, slug: true },
      });
      for (const company of companies) {
        const db = getTenantClient(company.tenantDbUrl);
        await recalculateHistoricalPayouts(db, company.slug);
      }
    } catch (err: unknown) {
      console.error('[Cron Mensuel] Erreur recalcul payouts:', err);
    }
  })();
});

// ─── Rapport CEO mensuel automatique (le 6 de chaque mois à 6h) ─────────────

cron.schedule('0 6 6 * *', () => {
  console.log('[CeoReport] Cron mensuel — génération rapport mois précédent');
  void (async () => {
    try {
      const master = getMasterClient();
      const companies = await master.company.findMany({
        where: { isActive: true },
        select: { tenantDbUrl: true, slug: true },
      });
      const prev = new Date();
      prev.setMonth(prev.getMonth() - 1);
      const monthKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

      for (const company of companies) {
        try {
          const db = getTenantClient(company.tenantDbUrl);
          const existing = await db.ceoReport.findFirst({
            where: { companyId: company.slug, month: monthKey, mode: 'annual' },
          });
          if (existing?.status === 'ready' || existing?.status === 'generating') continue;
          let report;
          if (existing) {
            report = await db.ceoReport.update({
              where: { id: existing.id },
              data: { status: 'generating', generatedAt: null },
            });
          } else {
            report = await db.ceoReport.create({
              data: { companyId: company.slug, month: monthKey, mode: 'annual', status: 'generating' },
            });
          }
          void generateCeoReportAsync(company.tenantDbUrl, report.id, company.slug, monthKey);
          console.log(`[CeoReport] Génération lancée ${company.slug} — ${monthKey}`);
        } catch (e) { console.error(`[CeoReport] Erreur cron ${company.slug}:`, e); }
      }
    } catch (e) { console.error('[CeoReport] Erreur cron mensuel:', e); }
  })();
});

// ─── CT / Révision — alerte Telegram J-30 (quotidien 9h) ────────────────────

async function runDocumentExpiryAlerts(): Promise<void> {
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { tenantDbUrl: true, slug: true },
    });
    const in30d = new Date(Date.now() + 30 * 86_400_000);
    for (const company of companies) {
      try {
        const db = getTenantClient(company.tenantDbUrl);
        const expiring = await db.technicalControl.findMany({
          where: { expiryAt: { lte: in30d, gte: new Date() } },
          include: { vehicle: { select: { make: true, model: true, licensePlate: true } } },
        });
        if (expiring.length === 0) continue;

        const chatId = await getTelegramChatId(db as never);
        for (const ct of expiring) {
          const days = Math.ceil((new Date(ct.expiryAt).getTime() - Date.now()) / 86_400_000);
          const label = `${ct.vehicle.make} ${ct.vehicle.model} (${ct.vehicle.licensePlate})`;

          // Admins + carkeepers assignés à ce véhicule
          const admins = await db.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } });
          const carkeepersRows = await db.vehicleCarkeeper.findMany({ where: { vehicleId: ct.vehicleId }, select: { userId: true } });
          const allRecipientIds = [...new Set([...admins.map(a => a.id), ...carkeepersRows.map(c => c.userId)])];
          for (const userId of allRecipientIds) {
            const existing = await db.notification.findFirst({
              where: { userId, type: 'ct_expiry_30d', relatedEntityId: ct.id },
            });
            if (existing) continue;
            await db.notification.create({
              data: {
                userId,
                type: 'ct_expiry_30d',
                title: `🔧 CT expire dans ${days} jour${days > 1 ? 's' : ''} — ${label}`,
                body: `Expiration : ${new Date(ct.expiryAt).toLocaleDateString('fr-FR')}`,
                relatedEntityType: 'vehicle',
                relatedEntityId: ct.vehicleId,
              },
            });
          }

          if (chatId) {
            await sendTelegramMessage(chatId,
              `🔧 <b>CT expire dans ${days} jour${days > 1 ? 's' : ''}</b>\n${label}\nExpiration : ${new Date(ct.expiryAt).toLocaleDateString('fr-FR')}`,
            );
          }
        }
      } catch (err: unknown) { console.error(`[CTExpiry] Erreur tenant ${company.slug}:`, err); }
    }
  } catch (err: unknown) { console.error('[CTExpiry] Erreur:', err); }
}

// ─── Alerte fin de trial J-3 (quotidien 9h) ─────────────────────────────────

async function runTrialExpiryAlerts(): Promise<void> {
  try {
    const master = getMasterClient();
    const now = new Date();
    const in3d = new Date(now.getTime() + 3 * 86_400_000);
    const in4d = new Date(now.getTime() + 4 * 86_400_000);

    const companies = await master.company.findMany({
      where: { isActive: true, trialEndsAt: { gte: in3d, lt: in4d } },
      select: { name: true, slug: true, tenantDbUrl: true, trialEndsAt: true },
    });

    for (const company of companies) {
      try {
        const db = getTenantClient(company.tenantDbUrl);
        const admins = await db.user.findMany({
          where: { role: 'admin', isActive: true },
          select: { email: true },
        });
        const expiryDate = company.trialEndsAt!.toLocaleDateString('fr-FR', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });
        for (const admin of admins) {
          if (!process.env.RESEND_API_KEY) {
            console.log(`[TrialExpiry] ${company.slug} → ${admin.email} — expire ${expiryDate}`);
            continue;
          }
          await sendEmail({
            to: admin.email,
            subject: '⏰ Votre essai expire dans 3 jours',
            html: trialExpiryEmailHtml(company.name, expiryDate),
          });
          console.log(`[TrialExpiry] Email envoyé → ${admin.email} (${company.slug})`);
        }
      } catch (err: unknown) {
        console.error(`[TrialExpiry] Erreur tenant ${company.slug}:`, err);
      }
    }
  } catch (err: unknown) {
    console.error('[TrialExpiry] Erreur:', err);
  }
}

cron.schedule('0 9 * * *', () => {
  void runDocumentExpiryAlerts();
  void runTrialExpiryAlerts();
});

// ─── Nettoyage notifications obsolètes (3h chaque jour) ─────────────────────

async function runNotificationCleanup(): Promise<void> {
  try {
    const master = getMasterClient();
    const companies = await master.company.findMany({
      where: { isActive: true },
      select: { tenantDbUrl: true, slug: true },
    });
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
    const sevenDaysAgo  = new Date(now.getTime() - 7  * 86_400_000);

    for (const company of companies) {
      try {
        const db = getTenantClient(company.tenantDbUrl);

        const [r1, r2] = await Promise.all([
          db.notification.deleteMany({ where: { isRead: true,  createdAt: { lt: thirtyDaysAgo } } }),
          db.notification.deleteMany({ where: { isRead: false, createdAt: { lt: ninetyDaysAgo } } }),
        ]);

        const staleIds = (await db.rental.findMany({
          where: { status: 'completed', endAt: { lt: sevenDaysAgo } },
          select: { id: true },
        })).map(r => r.id);

        let r3 = { count: 0 };
        if (staleIds.length > 0) {
          r3 = await db.notification.deleteMany({
            where: {
              type: { in: ['car_seat_request', 'accessory_request'] },
              relatedEntityType: 'rental',
              relatedEntityId: { in: staleIds },
            },
          });
        }

        const deleted = r1.count + r2.count + r3.count;
        if (deleted > 0) console.log(`[NotifCleanup] ${company.slug}: ${deleted} supprimée(s)`);
      } catch (err: unknown) {
        console.error(`[NotifCleanup] Erreur ${company.slug}:`, err);
      }
    }
  } catch (err: unknown) {
    console.error('[NotifCleanup] Erreur:', err);
  }
}

cron.schedule('0 3 * * *', () => void runNotificationCleanup());

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
