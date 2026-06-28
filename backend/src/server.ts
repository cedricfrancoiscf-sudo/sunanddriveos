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
import { analyzeAndProcessMessage, morningConversationReview, type RentalForMessaging } from './modules/messages/messaging.service';
import { decrypt } from './utils/crypto';
import { createGetaroundClient } from './modules/getaround-sync/getaround-api';
import { registerSyncTrigger } from './modules/getaround-sync/getaround-webhooks.routes';
import { notifyMileageAnomalies } from './modules/ai/ai.service';
import { getUpcomingMaintenances } from './modules/maintenance/maintenance.service';
import { sendEmail } from './utils/mailer';
import { trialExpiryEmailHtml } from './modules/email/templates';
import { sendTelegramMessage, getTelegramChatId } from './utils/telegram';
import { computeUnavailableDaysSet } from './utils/availability';

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const app = createApp();

// Verrous anti-chevauchement des crons
let isSequenceRunning = false;
let isSyncRunning = false;
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

    // BLOC 3D — tous les tenants en parallèle
    await Promise.allSettled(companies.map(async company => {
      const db = getTenantClient(company.tenantDbUrl);
      const accounts = await db.getaroundAccount.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      // BLOC 3A — tous les comptes du tenant en parallèle
      await Promise.allSettled(accounts.map(account =>
        syncRecentWindowForAccount(db, account.id, company.slug)
          .catch(err => console.error(`[RecentSync] ${company.slug} compte ${account.id} :`, err instanceof Error ? err.message : err)),
      ));

      // Rattrapage + unavailabilities en parallèle (indépendants l'un de l'autre)
      await Promise.allSettled([
        db.rental.updateMany({ where: { status: 'active', endAt: { lt: new Date() } }, data: { status: 'completed' } })
          .then(r => { if (r.count > 0) console.log(`[RecentSync] ${company.slug} : ${r.count} expirée(s) → completed`); })
          .catch(e => console.error(`[RecentSync] Rattrapage ${company.slug}:`, e)),
        syncUnavailabilitiesForTenant(db, company.slug)
          .catch(e => console.error(`[RecentSync] Unavailabilities ${company.slug}:`, e)),
      ]);

      void cleanupObsoleteSequences(db).catch(e => console.error('[RecentSync] cleanup séquences:', e));
    }));

    // Exécution séquences après sync (tous tenants)
    void runSequenceScheduler().catch(e => console.error('[RecentSync] Erreur séquences post-sync:', e));
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
        const accounts = await db.getaroundAccount.findMany({
          where: { isActive: true },
          select: { id: true, apiKeyHash: true },
        });
        const gaClients = new Map(accounts.map(a => [a.id, createGetaroundClient(decrypt(a.apiKeyHash))]));

        const newInbound = await db.message.findMany({
          where: {
            direction: 'inbound',
            status: 'sent',
            aiSuggestion: null,
            rental: {
              status: { in: ['booked', 'active'] },
              endAt: { gt: new Date() },
            },
          },
          select: {
            id: true, content: true,
            rental: {
              select: {
                id: true, vehicleId: true, driverName: true,
                driverGetaroundId: true, getaroundId: true, startAt: true, endAt: true, status: true,
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

        console.log(`[ProactiveMsg] ${newInbound.length} message(s) à traiter pour tenant ${company.slug}`);
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
              driverGetaroundId: r.driverGetaroundId, getaroundId: r.getaroundId, startAt: r.startAt, endAt: r.endAt, status: r.status,
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
      select: { tenantDbUrl: true, slug: true, name: true },
    });
    for (const company of companies) {
      try {
        const db = getTenantClient(company.tenantDbUrl);
        const cutoff30m = new Date(Date.now() - 30 * 60_000);
        const twentyFourHoursAgo2 = new Date(Date.now() - 24 * 3_600_000);

        const accounts = await db.getaroundAccount.findMany({
          where: { isActive: true },
          select: { id: true, apiKeyHash: true },
        });
        const gaClients = new Map(accounts.map(a => [a.id, createGetaroundClient(decrypt(a.apiKeyHash))]));

        const rentals = await db.rental.findMany({
          where: {
            // Uniquement les locations actives/réservées démarrées dans les 24h
            status: { in: ['booked', 'active'] },
            startAt: { gte: twentyFourHoursAgo2 },
          },
          select: {
            id: true, vehicleId: true, driverName: true,
            driverGetaroundId: true, getaroundId: true, startAt: true, endAt: true, status: true,
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
            driverGetaroundId: rental.driverGetaroundId, getaroundId: rental.getaroundId, startAt: rental.startAt, endAt: rental.endAt, status: rental.status,
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

        // ── 1) Relecture matinale des conversations ───────────────────────────
        const now = new Date();
        const ongoingRentals = await db.rental.findMany({
          where: { status: { in: ['booked', 'active'] }, endAt: { gt: now } },
          select: {
            id: true, vehicleId: true, driverName: true,
            driverGetaroundId: true, getaroundId: true, startAt: true, endAt: true, status: true,
            vehicle: { select: { make: true, model: true, licensePlate: true, parkingZone: true, deliveryPointName: true } },
            messages: { orderBy: { createdAt: 'asc' }, select: { direction: true, content: true } },
          },
        });

        for (const rental of ongoingRentals) {
          try {
            const rentalData: RentalForMessaging = {
              id: rental.id, vehicleId: rental.vehicleId, driverName: rental.driverName,
              driverGetaroundId: rental.driverGetaroundId, getaroundId: rental.getaroundId,
              startAt: rental.startAt, endAt: rental.endAt, status: rental.status,
              vehicle: { make: rental.vehicle.make, model: rental.vehicle.model, licensePlate: rental.vehicle.licensePlate, parkingZone: rental.vehicle.parkingZone, deliveryPointName: rental.vehicle.deliveryPointName },
            };
            await morningConversationReview(rentalData, rental.messages, db);
          } catch (e) { console.error(`[MorningReview] Erreur rental ${rental.id}:`, e); }
        }

        console.log(`[Cron 7h] ${company.slug} Rebalayage + relecture : ${ongoingRentals.length} location(s) analysée(s)`);

        // ─── Valuation mensuelle Autobiz (si clé configurée et pas déjà faite ce mois) ───
        await updateVehicleValuationsIfNeeded(db, company.slug);

        // ─── Alertes intelligence : baisse note + sous-utilisation ────────────
        await runIntelligenceAlerts(db, company.slug);

        // ─── Alertes ROI fenêtre de revente optimale ────────────────────────
        await runRoiAlerts(db, company.slug);
      } catch (e) { console.error(`[Rebalayage] Erreur tenant ${company.slug}:`, e); }
    }
  } catch (e) { console.error('[Rebalayage] Erreur générale:', e); }
  finally { isRebalayageRunning = false; }
}

async function updateVehicleValuationsIfNeeded(db: ReturnType<typeof getTenantClient>, slug: string): Promise<void> {
  try {
    const settings = await db.companySettings.findFirst();
    const apiKey = settings?.autobizApiKey ?? process.env.AUTOBIZ_API_KEY;
    if (!apiKey) return; // Clé non configurée, pas d'estimation

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const vehicles = await db.vehicle.findMany({
      where: { isActive: true },
      select: { id: true, make: true, model: true, year: true, currentMileage: true, purchasePrice: true },
    });

    for (const v of vehicles) {
      // Vérifier si une valuation existe déjà ce mois
      const existing = await db.vehicleValuation.findFirst({
        where: { vehicleId: v.id, evaluatedAt: { gte: monthStart } },
      });
      if (existing) continue;

      // Estimation simplifiée par dépréciation linéaire si API non joignable
      // Une vraie intégration Autobiz appellerait : POST https://api.autobiz.fr/v1/valuation
      let estimatedValue: number | null = null;
      try {
        // Appel Autobiz (stub — remplacer par l'appel réel avec la documentation API)
        const res = await fetch('https://api.autobiz.com/v1/estimations', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ make: v.make, model: v.model, year: v.year, mileage: v.currentMileage }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = await res.json() as { estimatedValue?: number; price?: number };
          estimatedValue = data.estimatedValue ?? data.price ?? null;
        }
      } catch {
        // Fallback : dépréciation linéaire 15%/an depuis prix achat
        if (v.purchasePrice) {
          const ageYears = now.getFullYear() - v.year;
          const deprecRate = Math.min(0.15 * ageYears, 0.8);
          estimatedValue = Math.round(v.purchasePrice * (1 - deprecRate));
        }
      }

      if (estimatedValue !== null && estimatedValue > 0) {
        await db.vehicleValuation.create({
          data: { vehicleId: v.id, estimatedValue, source: 'autobiz', evaluatedAt: now },
        });
      }
    }
    console.log(`[Valuations] ${slug} : estimations mises à jour`);
  } catch (e) { console.error(`[Valuations] Erreur ${slug}:`, e); }
}

async function runIntelligenceAlerts(db: ReturnType<typeof getTenantClient>, slug: string): Promise<void> {
  try {
    const settings = await db.companySettings.findFirst({
      select: {
        ratingDropThreshold: true,
        underutilizationThreshold: true,
        underutilizationWeeks: true,
      },
    });
    const ratingDropThreshold = settings?.ratingDropThreshold ?? 0.0;
    const underutilizationThreshold = settings?.underutilizationThreshold ?? 0.30;
    const underutilizationWeeks = settings?.underutilizationWeeks ?? 4;

    // ── BLOC 1 : Alerte baisse note ───────────────────────────────────────────
    const prevPeriod = new Date();
    prevPeriod.setMonth(prevPeriod.getMonth() - 1);
    const prevMonthStr = prevPeriod.toISOString().slice(0, 7);
    const curPeriod = new Date();
    curPeriod.setMonth(curPeriod.getMonth() - 0);
    const curMonthStr = curPeriod.toISOString().slice(0, 7);

    const [curRatings, prevRatings, vehicles] = await Promise.all([
      db.vehicleRating.findMany({ where: { period: curMonthStr }, select: { vehicleId: true, rating: true } }),
      db.vehicleRating.findMany({ where: { period: prevMonthStr }, select: { vehicleId: true, rating: true } }),
      db.vehicle.findMany({ where: { isActive: true }, select: { id: true, make: true, model: true, licensePlate: true } }),
    ]);

    const vehicleMap = new Map(vehicles.map(v => [v.id, v]));
    const prevMap = new Map(prevRatings.map(r => [r.vehicleId, r.rating]));
    const adminUsers = await db.user.findMany({
      where: { isActive: true, OR: [{ role: { in: ['admin', 'exploitation'] as never[] } }, { roles: { hasSome: ['admin', 'exploitation'] } }] },
      select: { id: true },
    });

    for (const cur of curRatings) {
      const prev = prevMap.get(cur.vehicleId);
      if (prev == null) continue;
      const drop = prev - cur.rating;
      if (drop <= ratingDropThreshold) continue;

      const v = vehicleMap.get(cur.vehicleId);
      const label = v ? `${v.make} ${v.model} (${v.licensePlate})` : cur.vehicleId;

      for (const admin of adminUsers) {
        await db.notification.create({
          data: {
            userId: admin.id,
            type: 'rating_drop',
            title: `⚠️ Baisse de note détectée — ${label}`,
            body: `Note passée de ${prev.toFixed(1)} → ${cur.rating.toFixed(1)} (${drop.toFixed(1)} pt). Vérifiez les avis locataires.`,
            relatedEntityType: 'vehicle',
            relatedEntityId: cur.vehicleId,
            targetUrl: `/intelligence/ratings`,
          },
        });
      }

      const chatId = await getTelegramChatId(db as never);
      if (chatId) {
        await sendTelegramMessage(chatId,
          `⚠️ Baisse de note Getaround — ${slug}\n${label} : ${prev.toFixed(1)} → ${cur.rating.toFixed(1)} (-${drop.toFixed(1)} pt)\n💡 Suggestions : vérifier l'état du véhicule, relire les derniers avis, améliorer la propreté et la ponctualité de remise.`);
      }
    }

    // ── BLOC 2 : Alerte sous-utilisation ─────────────────────────────────────
    const weeksAgo = new Date();
    weeksAgo.setDate(weeksAgo.getDate() - underutilizationWeeks * 7);

    const activeVehicles = await db.vehicle.findMany({
      where: { isActive: true },
      select: { id: true, make: true, model: true, licensePlate: true },
    });

    const periodDays = underutilizationWeeks * 7;

    // Fetch blockings + unavailabilities for the whole period (all vehicles at once)
    const [periodBlockings, periodUnavailabilities] = await Promise.all([
      db.blocking.findMany({
        where: { startAt: { lte: new Date() }, endAt: { gte: weeksAgo } },
        select: { vehicleId: true, startAt: true, endAt: true, type: true },
      }),
      db.unavailability.findMany({
        where: { startsAt: { lte: new Date() }, endsAt: { gte: weeksAgo } },
        select: { vehicleId: true, startsAt: true, endsAt: true },
      }),
    ]);

    for (const vehicle of activeVehicles) {
      const rentals = await db.rental.findMany({
        where: { vehicleId: vehicle.id, startAt: { gte: weeksAgo }, status: { in: ['active', 'completed'] } },
        select: { startAt: true, endAt: true },
      });

      const occupiedDays = new Set<string>();
      const now2 = new Date();
      for (const r of rentals) {
        const s = new Date(r.startAt);
        const e = r.endAt ? new Date(r.endAt) : now2;
        for (let d = new Date(s); d <= e && d <= now2; d.setDate(d.getDate() + 1)) {
          occupiedDays.add(d.toISOString().slice(0, 10));
        }
      }

      // Calcul du taux brut
      const occupancyRateRaw = occupiedDays.size / periodDays;

      // Calcul du taux corrigé (hors jours d'indisponibilité)
      const vBlockings    = periodBlockings.filter(b => b.vehicleId === vehicle.id);
      const vUnavailables = periodUnavailabilities.filter(u => u.vehicleId === vehicle.id);
      const indispoSet = computeUnavailableDaysSet(
        vBlockings,
        vUnavailables.map(u => ({ startsAt: u.startsAt, endsAt: u.endsAt })),
        weeksAgo,
        now2,
      );
      const unavailableDays = indispoSet.size;
      const adjustedDays = Math.max(1, periodDays - unavailableDays);
      const occupancyRateCorrected = occupiedDays.size / adjustedDays;

      // Alerte seulement si le taux CORRIGÉ est sous le seuil
      if (occupancyRateCorrected >= underutilizationThreshold) continue;

      const label2 = `${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})`;
      const pctRaw = Math.round(occupancyRateRaw * 100);
      const pctCorr = Math.round(occupancyRateCorrected * 100);
      const indispoNote = unavailableDays > 0
        ? ` (${unavailableDays} j indispo exclus)`
        : '';

      for (const admin of adminUsers) {
        await db.notification.create({
          data: {
            userId: admin.id,
            type: 'underutilization',
            title: `📉 Sous-utilisation véhicule — ${label2}`,
            body: `Taux corrigé : ${pctCorr}%${indispoNote} · Taux brut : ${pctRaw}% · Seuil : ${Math.round(underutilizationThreshold * 100)}% · Période : ${underutilizationWeeks} semaines.`,
            relatedEntityType: 'vehicle',
            relatedEntityId: vehicle.id,
            targetUrl: `/vehicles/${vehicle.id}`,
          },
        });
      }

      const chatId2 = await getTelegramChatId(db as never);
      if (chatId2) {
        await sendTelegramMessage(chatId2,
          `📉 Sous-utilisation — ${slug}\n${label2} : ${pctCorr}% corrigé${indispoNote} (brut ${pctRaw}%) sur ${underutilizationWeeks} sem.\n💡 Actions : revoir le prix, améliorer les photos, vérifier la disponibilité, proposer des promotions.`);
      }
    }

    console.log(`[Intelligence] ${slug} : alertes notes + sous-utilisation traitées`);
  } catch (e) { console.error(`[Intelligence] Erreur alertes ${slug}:`, e); }
}

async function runRoiAlerts(db: ReturnType<typeof getTenantClient>, slug: string): Promise<void> {
  try {
    const { calculateOptimalSaleWindow } = await import('./modules/vehicles/roi.service');
    const vehicles = await db.vehicle.findMany({
      where: { isActive: true },
      select: { id: true, make: true, model: true, licensePlate: true, purchasePrice: true, purchaseDate: true, marketValue: true },
    });

    const adminUsers = await db.user.findMany({
      where: { isActive: true, roles: { has: 'admin' } },
      select: { id: true },
    });
    if (adminUsers.length === 0) return;

    const chatId = await getTelegramChatId(db as never);
    let count = 0;

    for (const v of vehicles) {
      if (!v.purchasePrice || !v.purchaseDate || !v.marketValue) continue;
      try {
        const analysis = await calculateOptimalSaleWindow(v.id, db);
        if (!analysis) continue;
        if (analysis.signal !== 'vendre_maintenant' && analysis.signal !== 'bientot') continue;

        const label = `${v.make} ${v.model} (${v.licensePlate})`;
        const signalLabel = analysis.signal === 'vendre_maintenant' ? 'ROI en déclin' : `fenêtre optimale dans ${analysis.moisOptimal} mois`;
        const title = analysis.signal === 'vendre_maintenant'
          ? `Revendre maintenant — ${label}`
          : `Fenêtre de revente dans ${analysis.moisOptimal} mois — ${label}`;
        const body = `ROI actuel : ${analysis.roiActuel.toFixed(1)}%. ${signalLabel}. Plus-value nette : ${analysis.plusValueNette.toLocaleString('fr-FR')} €.`;

        for (const admin of adminUsers) {
          const existing = await db.notification.findFirst({
            where: { userId: admin.id, type: 'roi_sale_alert', relatedEntityId: v.id },
          });
          if (existing) continue;
          await db.notification.create({
            data: {
              userId: admin.id,
              type: 'roi_sale_alert',
              title,
              body,
              relatedEntityType: 'vehicle',
              relatedEntityId: v.id,
              targetUrl: `/vehicles/${v.id}`,
            },
          });
        }

        if (chatId) {
          const icon = analysis.signal === 'vendre_maintenant' ? '🔴' : '🟡';
          await sendTelegramMessage(chatId,
            `${icon} <b>Revente véhicule</b> — ${slug}\n${label}\n${signalLabel}. ROI : ${analysis.roiActuel.toFixed(1)}%\nPlus-value nette : ${analysis.plusValueNette.toLocaleString('fr-FR')} €`);
        }
        count++;
      } catch (e) { console.error(`[ROI] Erreur véhicule ${v.id}:`, e); }
    }

    if (count > 0) console.log(`[ROI] ${slug} : ${count} alerte(s) revente générée(s)`);
  } catch (e) { console.error(`[ROI] Erreur alertes ${slug}:`, e); }
}

cron.schedule('0 7 * * *', () => void (async () => { await runMorningRebalayage(); await runMorningBriefing(); })());

// ─── Briefing opérationnel 7h (remplace résumé 7h et résumé 8h) ─────────────

async function runMorningBriefing(): Promise<void> {
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
        const cutoff2h = new Date(now.getTime() - 2 * 3_600_000);
        const dateLabel = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

        const [
          departures, returns, carSeatRequests,
          expiringCT, expiringMaint,
          pendingDrafts,
          anomalies,
          adminUsers,
          allCarkeepers,
        ] = await Promise.all([
          db.rental.findMany({
            where: { startAt: { gte: now, lte: in24h }, status: { in: ['booked', 'active'] } },
            select: {
              driverName: true, startAt: true,
              vehicle: { select: { id: true, make: true, model: true, licensePlate: true, parkingZone: true } },
            },
            orderBy: { startAt: 'asc' },
          }),
          db.rental.findMany({
            where: { endAt: { gte: now, lte: in24h }, status: { in: ['active', 'completed'] } },
            select: {
              driverName: true, endAt: true,
              vehicle: { select: { id: true, make: true, model: true, licensePlate: true, parkingZone: true } },
            },
            orderBy: { endAt: 'asc' },
          }),
          db.carSeatRequest.findMany({
            where: { rental: { status: { in: ['booked', 'active'] } } },
            select: {
              rental: {
                select: {
                  driverName: true, startAt: true,
                  vehicle: { select: { id: true, make: true, model: true, licensePlate: true, parkingZone: true } },
                },
              },
            },
          }),
          db.maintenanceTask.findMany({
            where: { type: 'ct', nextDueDate: { gte: now, lte: in30d }, vehicle: { isActive: true } },
            select: { nextDueDate: true, vehicle: { select: { id: true, make: true, model: true, licensePlate: true } } },
            orderBy: { nextDueDate: 'asc' },
          }),
          getUpcomingMaintenances(db),
          db.message.findMany({
            where: {
              direction: 'outbound', status: 'pending_approval',
              aiSuggestion: { not: null },
              rental: { status: { in: ['booked', 'active'] } },
            },
            select: {
              rental: { select: { driverName: true, vehicle: { select: { make: true, model: true, licensePlate: true } } } },
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
            distinct: ['rentalId'],
          }),
          db.rental.findMany({
            where: { status: 'booked', startAt: { lt: cutoff2h } },
            select: {
              driverName: true, startAt: true,
              vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
            },
          }),
          db.user.findMany({
            where: {
              isActive: true,
              OR: [{ role: { in: ['admin', 'exploitation'] as never[] } }, { roles: { hasSome: ['admin', 'exploitation'] } }],
            },
            select: { email: true, name: true },
          }),
          db.user.findMany({
            where: { isActive: true, OR: [{ role: 'carkeeper' as never }, { roles: { has: 'carkeeper' } }] },
            select: { email: true, name: true, role: true, roles: true, vehicleCarkeepers: { select: { vehicleId: true } } },
          }),
        ]);

        // CA du mois
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        const monthRentals = await db.rental.findMany({
          where: {
            status: { in: ['active', 'completed', 'booked'] },
            OR: [
              { startAt: { gte: startOfMonth, lte: endOfMonth } },
              { endAt: { gte: startOfMonth, lte: endOfMonth } },
            ],
          },
          select: { ownerPayout: true, grossRevenue: true },
        });
        const caMoisEncaisse = monthRentals.filter(r => r.ownerPayout != null).reduce((s, r) => s + (r.ownerPayout ?? 0), 0);
        const caMoisPrevisionnel = monthRentals.filter(r => r.ownerPayout == null).reduce((s, r) => s + (r.grossRevenue ?? 0), 0);

        // Messages sans réponse > 2h
        const unansweredRentalIds = (await db.rental.findMany({
          where: {
            status: { in: ['booked', 'active'] },
            messages: {
              some: { direction: 'inbound', createdAt: { lt: cutoff2h } },
              none: { direction: 'outbound', status: { in: ['approved', 'sent'] } },
            },
          },
          select: { id: true },
        })).map(r => r.id);

        const unansweredMessages = unansweredRentalIds.length > 0
          ? await db.message.findMany({
              where: { direction: 'inbound', createdAt: { lt: cutoff2h }, rentalId: { in: unansweredRentalIds } },
              select: {
                content: true,
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

        const maintenanceRows = [
          ...expiringCT.map(c => `CT — ${c.vehicle.make} ${c.vehicle.model} (${c.vehicle.licensePlate}) — expire le ${new Date(c.nextDueDate!).toLocaleDateString('fr-FR')}`),
          ...expiringMaint.map(m => {
            const parts: string[] = [`${m.type} — ${m.vehicle.make} ${m.vehicle.model} (${m.vehicle.licensePlate})`];
            if (m.nextServiceDate) {
              const d = Math.ceil((new Date(m.nextServiceDate).getTime() - now.getTime()) / 86_400_000);
              parts.push(d <= 0 ? `date dépassée` : `dans ${d} j`);
            }
            if (m.nextServiceMileage != null && m.vehicle.currentMileage != null) {
              parts.push(`dans ${(m.nextServiceMileage - m.vehicle.currentMileage).toLocaleString('fr-FR')} km`);
            }
            return parts.join(' — ');
          }),
        ];

        // Email complet admin/exploitation
        function buildAdminHtml(): string {
          return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#f8fafc">
<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
  <div style="background:#01696e;padding:20px 24px">
    <h1 style="color:#fff;font-size:18px;margin:0">☀️ Briefing opérationnel — ${company.name}</h1>
    <p style="color:#a7f3d0;font-size:12px;margin:4px 0 0">${dateLabel}</p>
  </div>
  <div style="padding:20px 24px">
    ${section('🚗', `Départs du jour (${departures.length})`, departures.map(r => `<b>${fmt(new Date(r.startAt))}</b> — ${r.driverName} · ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.licensePlate})${r.vehicle.parkingZone ? ` — ${r.vehicle.parkingZone}` : ''}`))}
    ${section('🔄', `Retours du jour (${returns.length})`, returns.map(r => `<b>${fmt(new Date(r.endAt!))}</b> — ${r.driverName} · ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.licensePlate})${r.vehicle.parkingZone ? ` — ${r.vehicle.parkingZone}` : ''}`))}
    ${section('🪑', `Sièges auto à préparer (${carSeatRequests.length})`, carSeatRequests.filter(r => r.rental).map(r => `${r.rental!.driverName} · ${r.rental!.vehicle.make} ${r.rental!.vehicle.model} (${r.rental!.vehicle.licensePlate}) — départ ${new Date(r.rental!.startAt).toLocaleDateString('fr-FR')}`))}
    ${section('🔧', `CT / Entretiens dans 30 j (${maintenanceRows.length})`, maintenanceRows)}
    ${section('✍️', `Brouillons IA à valider (${pendingDrafts.length})`, pendingDrafts.map(m => `${m.rental?.driverName ?? '?'} · ${m.rental?.vehicle.make} ${m.rental?.vehicle.model} (${m.rental?.vehicle.licensePlate})`))}
    ${section('💬', `Messages sans réponse > 2h (${unansweredMessages.length})`, unansweredMessages.map(m => `${m.rental?.driverName ?? '?'} · ${m.rental?.vehicle.make} ${m.rental?.vehicle.model} — <i>${m.content.slice(0, 60)}…</i>`))}
    ${section('💶', 'CA du mois en cours', [
      ...(caMoisEncaisse > 0 ? [`Encaissé : <b>${fmtEur(caMoisEncaisse)}</b>`] : []),
      ...(caMoisPrevisionnel > 0 ? [`Prévisionnel : ${fmtEur(caMoisPrevisionnel)}`] : []),
    ], 'Aucune location ce mois')}
    ${section('⚠️', `Anomalies (${anomalies.length})`, anomalies.map(r => `Départ non confirmé — ${r.driverName} · ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.licensePlate})`))}
  </div>
  <div style="background:#f1f5f9;padding:12px 24px;font-size:11px;color:#94a3b8">SunanddriveOS — briefing automatique 7h</div>
</div></body></html>`;
        }

        // Email filtré pour un carkeeper pur (pas admin/exploitation)
        function buildCarekeeperHtml(ckVehicleIds: Set<string>): string {
          const ckDepartures = departures.filter(r => ckVehicleIds.has(r.vehicle.id));
          const ckReturns = returns.filter(r => ckVehicleIds.has(r.vehicle.id));
          const ckSeats = carSeatRequests.filter(r => r.rental && ckVehicleIds.has(r.rental.vehicle.id));
          const ckMaint = [
            ...expiringCT.filter(c => ckVehicleIds.has(c.vehicle.id)).map(c => `CT — ${c.vehicle.make} ${c.vehicle.model} (${c.vehicle.licensePlate}) — expire le ${new Date(c.nextDueDate!).toLocaleDateString('fr-FR')}`),
            ...expiringMaint.filter(m => ckVehicleIds.has(m.vehicle.id)).map(m => {
              const parts: string[] = [`${m.type} — ${m.vehicle.make} ${m.vehicle.model} (${m.vehicle.licensePlate})`];
              if (m.nextServiceDate) {
                const d = Math.ceil((new Date(m.nextServiceDate).getTime() - now.getTime()) / 86_400_000);
                parts.push(d <= 0 ? `date dépassée` : `dans ${d} j`);
              }
              return parts.join(' — ');
            }),
          ];
          return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#f8fafc">
<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
  <div style="background:#01696e;padding:20px 24px">
    <h1 style="color:#fff;font-size:18px;margin:0">☀️ Vos véhicules du jour — ${company.name}</h1>
    <p style="color:#a7f3d0;font-size:12px;margin:4px 0 0">${dateLabel}</p>
  </div>
  <div style="padding:20px 24px">
    ${section('🚗', `Départs du jour (${ckDepartures.length})`, ckDepartures.map(r => `<b>${fmt(new Date(r.startAt))}</b> — ${r.driverName} · ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.licensePlate})${r.vehicle.parkingZone ? ` — ${r.vehicle.parkingZone}` : ''}`))}
    ${section('🔄', `Retours du jour (${ckReturns.length})`, ckReturns.map(r => `<b>${fmt(new Date(r.endAt!))}</b> — ${r.driverName} · ${r.vehicle.make} ${r.vehicle.model} (${r.vehicle.licensePlate})${r.vehicle.parkingZone ? ` — ${r.vehicle.parkingZone}` : ''}`))}
    ${section('🪑', `Sièges auto à préparer (${ckSeats.length})`, ckSeats.filter(r => r.rental).map(r => `${r.rental!.driverName} · ${r.rental!.vehicle.make} ${r.rental!.vehicle.model} (${r.rental!.vehicle.licensePlate}) — départ ${new Date(r.rental!.startAt).toLocaleDateString('fr-FR')}`))}
    ${section('🔧', `CT / Entretiens (${ckMaint.length})`, ckMaint)}
  </div>
  <div style="background:#f1f5f9;padding:12px 24px;font-size:11px;color:#94a3b8">SunanddriveOS — briefing automatique 7h</div>
</div></body></html>`;
        }

        if (adminUsers.length === 0 && allCarkeepers.length === 0) {
          console.log(`[MorningBriefing] ${company.slug} : aucun destinataire`);
          continue;
        }

        let emailsSent = 0;
        if (process.env.RESEND_API_KEY) {
          const adminHtml = buildAdminHtml();
          for (const u of adminUsers) {
            await sendEmail({
              to: u.email,
              subject: `☀️ Briefing opérationnel — ${company.name} — ${now.toLocaleDateString('fr-FR')}`,
              html: adminHtml,
            });
            emailsSent++;
          }
          // Pure carkeepers = has carkeeper role but NOT admin or exploitation
          for (const ck of allCarkeepers) {
            const ckAllRoles = [...(Array.isArray(ck.roles) ? ck.roles as string[] : []), ck.role as string].filter(Boolean);
            if (ckAllRoles.some(r => r === 'admin' || r === 'exploitation')) continue;
            const ckVehicleIds = new Set((ck.vehicleCarkeepers as { vehicleId: string }[]).map(v => v.vehicleId));
            if (ckVehicleIds.size === 0) continue;
            const ckHtml = buildCarekeeperHtml(ckVehicleIds);
            await sendEmail({
              to: ck.email,
              subject: `☀️ Vos véhicules du jour — ${now.toLocaleDateString('fr-FR')}`,
              html: ckHtml,
            });
            emailsSent++;
          }
        }

        console.log(`[MorningBriefing] ${company.slug} : ${departures.length} départs, ${returns.length} retours, ${pendingDrafts.length} brouillons — ${emailsSent} email(s) envoyé(s)`);
      } catch (e) { console.error(`[MorningBriefing] Erreur tenant ${company.slug}:`, e); }
    }
  } catch (e) { console.error('[MorningBriefing] Erreur générale:', e); }
}

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
        const expiring = await db.maintenanceTask.findMany({
          where: { type: 'ct', nextDueDate: { gte: new Date(), lte: in30d }, vehicle: { isActive: true } },
          select: { id: true, vehicleId: true, nextDueDate: true, vehicle: { select: { make: true, model: true, licensePlate: true } } },
        });
        if (expiring.length === 0) continue;

        // Fetch admins + chatId en parallèle (commun à tous les CT)
        const [chatId, admins] = await Promise.all([
          getTelegramChatId(db as never),
          db.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } }),
        ]);

        // BLOC 3C — traiter chaque CT en parallèle
        await Promise.allSettled(expiring.map(async ct => {
          const days = Math.ceil((new Date(ct.nextDueDate!).getTime() - Date.now()) / 86_400_000);
          const label = `${ct.vehicle.make} ${ct.vehicle.model} (${ct.vehicle.licensePlate})`;

          // Admins + carkeepers assignés en parallèle
          const carkeepersRows = await db.vehicleCarkeeper.findMany({ where: { vehicleId: ct.vehicleId }, select: { userId: true } });
          const allRecipientIds = [...new Set([...admins.map(a => a.id), ...carkeepersRows.map(c => c.userId)])];

          // Notifications — dedup par userId+type+relatedEntityId
          await Promise.allSettled(allRecipientIds.map(async userId => {
            const existing = await db.notification.findFirst({
              where: { userId, type: 'ct_expiry_30d', relatedEntityId: ct.id },
            });
            if (existing) return;
            await db.notification.create({
              data: {
                userId,
                type: 'ct_expiry_30d',
                title: `🔧 CT expire dans ${days} jour${days > 1 ? 's' : ''} — ${label}`,
                body: `Expiration : ${new Date(ct.nextDueDate!).toLocaleDateString('fr-FR')}`,
                relatedEntityType: 'vehicle',
                relatedEntityId: ct.vehicleId,
              },
            });
          }));

          if (chatId) {
            await sendTelegramMessage(chatId,
              `🔧 <b>CT expire dans ${days} jour${days > 1 ? 's' : ''}</b>\n${label}\nExpiration : ${new Date(ct.nextDueDate!).toLocaleDateString('fr-FR')}`,
            );
          }
        }));
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
