import type { PrismaClient } from '../../generated/tenant';
import { Prisma } from '../../generated/tenant';
import { decrypt, encrypt } from '../../utils/crypto';
import { createGetaroundClient, type GetaroundRental, parseInvoiceCharges } from './getaround-api';
import { scheduleSequencesForRental } from '../sequences/sequences.service';
import { analyzeMessage, suggestReply } from '../ai/ai.service';
import { sendTelegramMessage, getTelegramChatId } from '../../utils/telegram';
import { getMasterClient } from '../../prisma/client';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// ─── État de synchronisation en temps réel ───────────────────────────────────

interface SyncState {
  isRunning: boolean;
  currentStep: string;
  progress: number;
  totalItems: number;
  processedItems: number;
  lastSyncAt: Date | null;
  lastSyncResult: { created: number; updated: number } | null;
  error: string | null;
  isTrialLimited: boolean;
}

const syncStateMap: Record<string, SyncState> = {};

export function getSyncState(tenantSlug: string): SyncState {
  return syncStateMap[tenantSlug] ?? {
    isRunning: false,
    currentStep: 'Jamais synchronisé',
    progress: 0,
    totalItems: 0,
    processedItems: 0,
    lastSyncAt: null,
    lastSyncResult: null,
    error: null,
    isTrialLimited: false,
  };
}

export function updateSyncState(tenantSlug: string, update: Partial<SyncState>): void {
  syncStateMap[tenantSlug] = { ...getSyncState(tenantSlug), ...update };
}

export interface SyncResult {
  accountId: string;
  accountName: string;
  created: number;
  updated: number;
  errors: string[];
}

// ─── Limite d'historique par plan ────────────────────────────────────────────

function getMaxHistoryStart(plan: string, accountStartDate: Date | null): Date {
  const now = Date.now();
  const limits: Record<string, number> = {
    starter: 180 * 86_400_000,    // 6 mois
    pro: 730 * 86_400_000,         // 2 ans
    enterprise: 1825 * 86_400_000, // 5 ans
  };
  const limitMs = limits[plan] ?? limits['starter'];
  const planLimit = new Date(now - limitMs);

  if (accountStartDate) {
    return new Date(Math.max(planLimit.getTime(), accountStartDate.getTime()));
  }
  return planLimit;
}

// L'API Getaround ne retourne pas l'état des locations —
// on l'infère depuis les dates de début/fin
function inferStatus(r: GetaroundRental): 'booked' | 'active' | 'completed' {
  const now = Date.now();
  if (now < new Date(r.starts_at).getTime()) return 'booked';
  if (now < new Date(r.ends_at).getTime()) return 'active';
  return 'completed';
}

// ─── 1. Véhicules ───────────────────────────────────────────────────────────

export async function syncAccountVehicles(
  db: PrismaClient,
  accountId: string,
  tenantSlug = 'default',
): Promise<SyncResult> {
  const account = await db.getaroundAccount.findUnique({ where: { id: accountId } });
  if (!account) throw Object.assign(new Error('Compte Getaround introuvable'), { status: 404 });

  const result: SyncResult = {
    accountId,
    accountName: account.name,
    created: 0,
    updated: 0,
    errors: [],
  };

  await db.getaroundAccount.update({
    where: { id: accountId },
    data: { syncStatus: 'syncing' },
  });

  try {
    const apiKey = decrypt(account.apiKeyHash);
    const ga = createGetaroundClient(apiKey);

    // /cars.json → IDs seulement, puis /cars/{id}.json pour chaque
    const cars = await ga.getCars();

    for (const car of cars) {
      try {
        // Les voitures supprimées côté Getaround ne doivent pas entrer en base
        if (car.state === 'deleted') continue;

        // Champs API : id, state, plate_number, brand, model, address
        // Pas de year, color, picture_url, mileage dans l'API Owner v1
        const commonData = {
          getaroundAccount: { connect: { id: accountId } },
          make: car.brand ?? 'Inconnu',
          model: car.model ?? 'Inconnu',
          isActive: car.state === 'active',
        };

        // Pré-vérification pour distinguer create/update dans le compteur
        const existingVehicle = await db.vehicle.findUnique({
          where: { getaroundId: String(car.id) },
          select: { id: true },
        });

        await db.vehicle.upsert({
          where: { getaroundId: String(car.id) },
          create: {
            ...commonData,
            getaroundId: String(car.id),
            licensePlate: car.plate_number?.toUpperCase() ?? `GA-${car.id}`,
            year: new Date().getFullYear(), // non fourni par l'API Getaround
          },
          update: {
            ...commonData,
            ...(car.plate_number ? { licensePlate: car.plate_number.toUpperCase() } : {}),
          },
        });

        if (existingVehicle) result.updated++;
        else result.created++;
      } catch (err: unknown) {
        result.errors.push(`Voiture ${car.id}: ${err instanceof Error ? err.message : 'erreur'}`);
      }
    }

    await db.getaroundAccount.update({
      where: { id: accountId },
      data: { syncStatus: 'success', syncError: null },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error(`[Sync][${tenantSlug}] Erreur sync véhicules compte ${accountId} : ${msg}`);
    await db.getaroundAccount.update({
      where: { id: accountId },
      data: { syncStatus: 'error', syncError: msg },
    });
    throw err;
  }

  return result;
}

export async function syncAllAccounts(
  db: PrismaClient,
  tenantSlug = 'default',
): Promise<Array<{ vehicles: SyncResult; rentals: RentalSyncResult; messages: MessageSyncResult }>> {
  updateSyncState(tenantSlug, { isRunning: true, progress: 5, currentStep: 'Synchronisation des véhicules...', error: null });

  let accounts: Array<{ id: string }>;
  try {
    accounts = await db.getaroundAccount.findMany({
      where: { isActive: true },
      select: { id: true },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    updateSyncState(tenantSlug, { isRunning: false, error: msg, progress: 0 });
    throw err;
  }

  const results: Array<{ vehicles: SyncResult; rentals: RentalSyncResult; messages: MessageSyncResult }> = [];

  for (const account of accounts) {
    try {
      const vehicles = await syncAccountVehicles(db, account.id, tenantSlug);
      const rentals = await syncAccountRentals(db, account.id, undefined, undefined, tenantSlug);
      updateSyncState(tenantSlug, { progress: 90, currentStep: 'Synchronisation des factures...' });
      void syncAccountInvoicesPayouts(db, account.id).catch(e =>
        console.error(`[Sync][${tenantSlug}] Erreur invoices/payouts:`, e)
      );
      // Les messages sont synchros par syncMessagesForWindow à l'intérieur de syncAccountRentals
      // → pas d'appel séparé à syncAccountMessages pour éviter le double traitement
      const messages: MessageSyncResult = { accountId: account.id, created: 0, skipped: 0, errors: [] };
      results.push({ vehicles, rentals, messages });
      console.log(`[Sync][${tenantSlug}] Compte ${account.id} : succès`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Sync][${tenantSlug}] Compte ${account.id} : erreur — ${message}`);
      // Continuer avec le compte suivant
    }
  }

  const totalCreated = results.reduce((s, r) => s + r.vehicles.created + r.rentals.created, 0);
  const totalUpdated = results.reduce((s, r) => s + r.vehicles.updated + r.rentals.updated, 0);
  updateSyncState(tenantSlug, {
    isRunning: false, progress: 100, currentStep: 'Terminé',
    lastSyncAt: new Date(), lastSyncResult: { created: totalCreated, updated: totalUpdated },
  });

  return results;
}

// ─── 2. Locations — fonctions privées ────────────────────────────────────────

export interface RentalSyncResult {
  accountId: string;
  created: number;
  updated: number;
  errors: string[];
}

type GetaroundClient = ReturnType<typeof createGetaroundClient>;

// Traite une location : checkin + checkout + user + upsert + notifications
async function processRental(
  db: PrismaClient,
  ga: GetaroundClient,
  r: GetaroundRental,
  result: RentalSyncResult,
  tenantSlug: string,
  userCache: Map<number, string>,
): Promise<void> {
  // Liaison au véhicule via car_id Getaround
  const vehicle = await db.vehicle.findUnique({
    where: { getaroundId: String(r.car_id) },
    select: { id: true, currentMileage: true, make: true, model: true, licensePlate: true },
  });
  if (!vehicle) {
    result.errors.push(`Location ${r.id}: véhicule ${r.car_id} non trouvé en base`);
    return;
  }

  // Nom du conducteur via /users/{id}.json (mis en cache par user_id)
  if (!userCache.has(r.user_id)) {
    try {
      const user = await ga.getUser(r.user_id);
      await sleep(1000);
      userCache.set(r.user_id, `${user.first_name} ${user.last_name}`);
    } catch (err: unknown) {
      console.error(`[Sync][${tenantSlug}] Erreur user ${r.user_id}:`, err);
      userCache.set(r.user_id, `Conducteur ${r.user_id}`);
    }
  }
  const driverName = userCache.get(r.user_id)!;

  const status = inferStatus(r);
  const grossRevenue = r.price / 100;

  // Vérifier le statut existant pour ne pas écraser un 'cancelled' manuel
  const existingRental = await db.rental.findUnique({
    where: { getaroundId: String(r.id) },
    select: { id: true, status: true, startMileage: true, endMileage: true, fuelLevelCheckin: true },
  });
  const prevStatus = existingRental?.status;
  const newStatus = prevStatus === 'cancelled' ? 'cancelled' : status;

  const commonData = {
    vehicleId: vehicle.id,
    driverName,
    driverGetaroundId: String(r.user_id),
    startAt: new Date(r.starts_at),
    endAt: new Date(r.ends_at),
    grossRevenue,
  };

  const upserted = await db.rental.upsert({
    where: { getaroundId: String(r.id) },
    create: { ...commonData, getaroundId: String(r.id), driverEmail: null, status },
    update: { ...commonData, status: newStatus },
    select: { id: true },
  });

  if (!existingRental) {
    result.created++;
    if (status === 'booked') {
      void scheduleSequencesForRental(db, upserted.id, 'rental.booked').catch(console.error);
      void (async () => {
        try {
          const chatId = await getTelegramChatId(db as never);
          if (!chatId) return;
          const vehicleLabel = `${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})`;
          const startLabel = new Date(r.starts_at).toLocaleDateString('fr-FR');
          await sendTelegramMessage(chatId,
            `🚗 <b>Nouvelle réservation</b>\n${driverName}\n${vehicleLabel}\nDépart : ${startLabel}`,
          );
        } catch (e) { console.error('[Telegram] Nouvelle réservation:', e); }
      })();
    }
    void (async () => {
      try {
        const bl = await db.renterBlacklist.findUnique({ where: { driverGetaroundId: String(r.user_id) } });
        if (!bl) return;
        const admins = await db.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } });
        await db.notification.createMany({
          data: admins.map(a => ({
            userId: a.id,
            type: 'blacklisted_renter',
            title: `⛔ Locataire blacklisté — ${driverName}`,
            body: `Motif : ${bl.reason}`,
            relatedEntityType: 'rental',
            relatedEntityId: upserted.id,
          })),
          skipDuplicates: true,
        });
      } catch (e) { console.error('[BlacklistCheck]', e); }
    })();
  } else {
    result.updated++;
    if (prevStatus === 'booked' && newStatus === 'active') {
      void scheduleSequencesForRental(db, upserted.id, 'rental.car_checked_in').catch(console.error);
    } else if (prevStatus === 'active' && newStatus === 'completed') {
      void scheduleSequencesForRental(db, upserted.id, 'rental.car_checked_out').catch(console.error);
    }
  }

  // Checkin
  if (newStatus !== 'booked' && existingRental?.startMileage == null) {
    try {
      const checkin = await ga.getCheckin(r.id);
      await sleep(1000);
      const checkinData: Record<string, unknown> = {};
      if (checkin.mileage != null) checkinData.startMileage = Math.round(checkin.mileage);
      if (checkin.fuel_level != null) checkinData.fuelLevelCheckin = checkin.fuel_level;
      if (Object.keys(checkinData).length > 0) {
        await db.rental.update({ where: { id: upserted.id }, data: checkinData });
      }
    } catch (err: unknown) { console.error(`[Sync][${tenantSlug}] Checkin ${r.id}:`, err); }
  }

  // Checkout
  if (newStatus === 'completed' && existingRental?.endMileage == null) {
    try {
      const checkout = await ga.getCheckout(r.id);
      await sleep(1000);
      const checkoutData: Record<string, unknown> = {};
      if (checkout.mileage != null) {
        checkoutData.endMileage = Math.round(checkout.mileage);
        const newOdometer = checkoutData.endMileage as number;
        if (newOdometer > vehicle.currentMileage) {
          await db.vehicle.update({ where: { id: vehicle.id }, data: { currentMileage: newOdometer } });
        }
      }
      if (checkout.distance_driven != null) checkoutData.kmDriven = Math.round(checkout.distance_driven);
      if (checkout.fuel_level != null) checkoutData.fuelLevelCheckout = checkout.fuel_level;
      if (Object.keys(checkoutData).length > 0) {
        await db.rental.update({ where: { id: upserted.id }, data: checkoutData });
      }

      // Alerte carburant insuffisant : niveau retour < 25%
      const fuelIn = existingRental?.fuelLevelCheckin ?? null;
      const fuelOut = checkout.fuel_level;
      if (fuelOut != null && fuelOut < 0.25) {
        const vehicleLabel = `${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})`;
        const admins = await db.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } });
        await db.notification.createMany({
          data: admins.map(a => ({
            userId: a.id,
            type: 'fuel_insufficient',
            title: `⛽ Carburant insuffisant — ${driverName}`,
            body: `${vehicleLabel} — Retour: ${Math.round(fuelOut * 100)}%${fuelIn != null ? ` / Départ: ${Math.round(fuelIn * 100)}%` : ''}`,
            relatedEntityType: 'rental',
            relatedEntityId: upserted.id,
          })),
          skipDuplicates: true,
        });
        void (async () => {
          try {
            const chatId = await getTelegramChatId(db as never);
            if (!chatId) return;
            await sendTelegramMessage(chatId,
              `⛽ <b>Carburant insuffisant</b>\n${driverName} — ${vehicleLabel}\nRetour : ${Math.round(fuelOut * 100)}%${fuelIn != null ? ` (départ : ${Math.round(fuelIn * 100)}%)` : ''}`,
            );
          } catch (e) { console.error('[Telegram] Fuel:', e); }
        })();
      }
    } catch (err: unknown) { console.error(`[Sync][${tenantSlug}] Checkout ${r.id}:`, err); }
  }

  // Décomposition CA depuis les factures de la location
  try {
    const invoices = await ga.getRentalInvoices(r.id);
    await sleep(500);
    if (invoices.length > 0) {
      const bd = parseInvoiceCharges(invoices);
      await db.rental.update({
        where: { id: upserted.id },
        data: {
          ...(bd.basePrice        ? { basePrice: bd.basePrice }               : {}),
          ...(bd.extraDistanceFee ? { extraDistanceFee: bd.extraDistanceFee } : {}),
          ...(bd.insuranceFee     ? { insuranceFee: bd.insuranceFee }         : {}),
          ...(bd.assistanceFee    ? { assistanceFee: bd.assistanceFee }       : {}),
          ...(bd.deliveryFee      ? { deliveryFee: bd.deliveryFee }           : {}),
          ...(bd.lateReturnFee    ? { lateReturnFee: bd.lateReturnFee }       : {}),
          ...(bd.gasRefillFee     ? { gasRefillFee: bd.gasRefillFee }         : {}),
          ...(bd.driverMessFee    ? { driverMessFee: bd.driverMessFee }       : {}),
          ...(bd.damageCompensation ? { damageCompensation: bd.damageCompensation } : {}),
          ...(bd.grossRevenue     ? { grossRevenue: bd.grossRevenue }         : {}),
          ...(bd.ownerPayout      ? { ownerPayout: bd.ownerPayout }           : {}),
        },
      });
    }
  } catch { /* Invoices non disponibles pour cette location — skip silencieusement */ }
}

// Sync les messages des locations dont startAt est dans la fenêtre
async function syncMessagesForWindow(
  db: PrismaClient,
  ga: GetaroundClient,
  accountId: string,
  windowStart: Date,
  windowEnd: Date,
  tenantSlug: string,
): Promise<void> {
  const rentals = await db.rental.findMany({
    where: {
      vehicle: { getaroundAccountId: accountId },
      startAt: { gte: windowStart, lte: windowEnd },
    },
    select: {
      id: true,
      getaroundId: true,
      driverGetaroundId: true,
      vehicleId: true,
      driverName: true,
      startAt: true,
      vehicle: { select: { make: true, model: true, licensePlate: true } },
    },
  });

  console.log(`[Sync][${tenantSlug}] Messages : ${rentals.length} location(s) dans la fenêtre`);

  for (const rental of rentals) {
    if (!rental.getaroundId) continue;
    const gaRentalId = parseInt(rental.getaroundId, 10);

    try {
      const messages = await ga.getMessages(gaRentalId);

      for (const msg of messages) {
        try {
          const direction =
            rental.driverGetaroundId && String(msg.sending_user_id) === rental.driverGetaroundId
              ? ('inbound' as const)
              : ('outbound' as const);

          const { id: msgDbId, createdAt: msgCreatedAt } = await db.message.upsert({
            where: { getaroundId: String(msg.id) },
            create: {
              getaroundId: String(msg.id),
              rentalId: rental.id,
              direction,
              content: msg.content,
              sentAt: new Date(msg.sent_at),
              status: 'sent',
            },
            update: {
              content: msg.content,
            },
            select: { id: true, createdAt: true },
          });

          // Détection siège auto uniquement sur les messages entrants nouveaux
          // (createdAt proche de now = vient d'être créé par l'upsert)
          const isNew = Date.now() - msgCreatedAt.getTime() < 10_000;
          void msgDbId; // utilisé dans les closures ci-dessous

          if (direction === 'inbound' && isNew) {
            void (async () => {
              try {
                const analysis = await analyzeMessage(msg.content);
                if (!analysis.isCarSeatRequest) return;
                const existingReq = await db.carSeatRequest.findFirst({ where: { rentalId: rental.id } });
                if (existingReq) return;
                await db.carSeatRequest.create({
                  data: { vehicleId: rental.vehicleId, rentalId: rental.id },
                });
                const vehicleLabel = `${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})`;
                const startLabel = rental.startAt.toLocaleDateString('fr-FR');
                const [admins, carkeepersAssigned] = await Promise.all([
                  db.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } }),
                  db.vehicleCarkeeper.findMany({ where: { vehicleId: rental.vehicleId }, select: { userId: true } }),
                ]);
                const recipientIds = [...new Set([...admins.map(a => a.id), ...carkeepersAssigned.map(c => c.userId)])];
                await db.notification.createMany({
                  data: recipientIds.map(userId => ({
                    userId,
                    type: 'car_seat_request',
                    title: `🪑 Siège auto demandé par ${rental.driverName} pour ${vehicleLabel} le ${startLabel}`,
                    body: `Message : ${msg.content.slice(0, 120)}`,
                    relatedEntityType: 'rental',
                    relatedEntityId: rental.id,
                  })),
                  skipDuplicates: true,
                });
                void (async () => {
                  try {
                    const chatId = await getTelegramChatId(db as never);
                    if (!chatId) return;
                    await sendTelegramMessage(chatId,
                      `🪑 <b>Siège auto demandé</b>\n${rental.driverName} — ${vehicleLabel}\nDépart le ${startLabel}`,
                    );
                  } catch (e) { console.error('[Telegram] Siège auto:', e); }
                })();
              } catch (e) { console.error('[CarSeatDetect]', e); }
            })();
          }
        } catch { /* ignorer erreurs message individuel */ }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Sync][${tenantSlug}] Erreur messages rental ${rental.getaroundId}: ${msg}`);
    }

    await sleep(500); // toujours exécuté, même en cas d'erreur
  }
}

// ─── 2. Locations — sync mois par mois ──────────────────────────────────────

export async function syncAccountRentals(
  db: PrismaClient,
  accountId: string,
  from?: Date,
  to?: Date,
  tenantSlug = 'default',
): Promise<RentalSyncResult> {
  const account = await db.getaroundAccount.findUnique({ where: { id: accountId } });
  if (!account) throw Object.assign(new Error('Compte Getaround introuvable'), { status: 404 });

  const result: RentalSyncResult = { accountId, created: 0, updated: 0, errors: [] };
  const apiKey = decrypt(account.apiKeyHash);
  const ga = createGetaroundClient(apiKey);

  // Récupérer plan + trial depuis la DB master
  let tenantPlan = 'starter';
  let trialActive = false;
  if (tenantSlug !== 'default') {
    try {
      const masterDb = getMasterClient();
      const company = await masterDb.company.findFirst({ where: { slug: tenantSlug } });
      tenantPlan = company?.plan ?? 'starter';
      trialActive = company?.trialEndsAt != null && company.trialEndsAt > new Date() && !company.stripeSubscriptionId;
    } catch (e) { console.error(`[Sync][${tenantSlug}] Erreur plan/trial:`, e); }
  }

  let absoluteStart = getMaxHistoryStart(tenantPlan, account.accountStartDate ?? null);

  if (trialActive) {
    const trialLimit = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    if (trialLimit > absoluteStart) absoluteStart = trialLimit;
    console.log(`[Sync][${tenantSlug}] Mode trial — sync limitée aux 90 derniers jours`);
    updateSyncState(tenantSlug, { isTrialLimited: true });
  }

  // Sync manuelle avec fenêtre explicite (route /sync-rentals/:id?from=&to=)
  if (from !== undefined || to !== undefined) {
    const windowStart = from ?? absoluteStart;
    const windowEnd = to ?? new Date(Date.now() + 90 * 86_400_000);
    console.log(`[Sync][${tenantSlug}] Sync manuelle : ${windowStart.toISOString().slice(0, 10)} → ${windowEnd.toISOString().slice(0, 10)}`);
    const windowRentals = await ga.getRentals(windowStart, windowEnd);
    const userCache = new Map<number, string>();
    for (let i = 0; i < windowRentals.length; i++) {
      await processRental(db, ga, windowRentals[i], result, tenantSlug, userCache);
      console.log(`[Sync][${tenantSlug}] ${i + 1}/${windowRentals.length} Location sauvegardée: ${windowRentals[i].id}`);
      await sleep(2_000);
    }
    return result;
  }

  // ── Sync automatique mois par mois (du plus récent au plus ancien) ──────────
  //
  // Premier appel (lastSyncAt=null) : windowEnd = now+90j pour capturer les
  // réservations futures. Chaque fenêtre traitée met lastSyncAt à windowStart
  // (= début de la fenêtre), permettant de reprendre là où on s'est arrêté.

  let windowEnd = account.lastSyncAt
    ? new Date(account.lastSyncAt)
    : new Date(Date.now() + 90 * 86_400_000);

  let windowStart = new Date(Math.max(
    windowEnd.getTime() - 30 * 86_400_000,
    absoluteStart.getTime(),
  ));

  const userCache = new Map<number, string>();

  console.log(`[Sync][${tenantSlug}] ═══ DÉBUT SYNC ═══`);
  console.log(`[Sync][${tenantSlug}] Plan: ${tenantPlan} | absoluteStart: ${absoluteStart.toISOString().slice(0, 10)}`);
  updateSyncState(tenantSlug, { isRunning: true, progress: 10, currentStep: 'Démarrage sync...', error: null });

  let windowIndex = 0;

  while (windowEnd > absoluteStart) {
    windowIndex++;
    const winLabel = `${windowStart.toISOString().slice(0, 10)} → ${windowEnd.toISOString().slice(0, 10)}`;
    console.log(`[Sync][${tenantSlug}] Fenêtre ${windowIndex} : ${winLabel}`);
    updateSyncState(tenantSlug, {
      currentStep: `Fenêtre ${windowStart.toISOString().slice(0, 7)} : chargement...`,
      progress: 15,
    });

    try {
      // 1. Locations de la fenêtre
      const windowRentals = await ga.getRentals(windowStart, windowEnd);
      console.log(`[Sync][${tenantSlug}] ${windowRentals.length} location(s) récupérée(s)`);
      updateSyncState(tenantSlug, { totalItems: windowRentals.length, processedItems: 0 });

      // 2. Traiter chaque location séquentiellement
      for (let i = 0; i < windowRentals.length; i++) {
        const r = windowRentals[i];
        await processRental(db, ga, r, result, tenantSlug, userCache);
        console.log(`[Sync][${tenantSlug}] ${i + 1}/${windowRentals.length} Location sauvegardée: ${r.id}`);
        updateSyncState(tenantSlug, {
          processedItems: i + 1,
          currentStep: `Fenêtre ${windowStart.toISOString().slice(0, 7)} : ${i + 1}/${windowRentals.length} locations`,
          progress: Math.round(15 + ((i + 1) / Math.max(windowRentals.length, 1)) * 65),
        });
        await sleep(2_000);
      }

      // 3. Messages de la fenêtre
      updateSyncState(tenantSlug, {
        currentStep: `Fenêtre ${windowStart.toISOString().slice(0, 7)} : messages...`,
      });
      await syncMessagesForWindow(db, ga, accountId, windowStart, windowEnd, tenantSlug);

      // 4. Payouts de la fenêtre
      await syncPayoutsForWindow(db, ga, windowStart, windowEnd, tenantSlug);

      // 5. Mettre à jour lastSyncAt avec le début de cette fenêtre
      await db.getaroundAccount.update({
        where: { id: accountId },
        data: { lastSyncAt: windowStart, syncStatus: 'success', syncError: null },
      });
      console.log(`[Sync][${tenantSlug}] Fenêtre terminée ✓ (${windowRentals.length}/${windowRentals.length})`);
      console.log(`[Sync][${tenantSlug}] lastSyncAt → ${windowStart.toISOString().slice(0, 10)}`);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const isRateLimitMax = err instanceof Error && err.message.includes('[RateLimit] Max');
      console.error(`[Sync][${tenantSlug}] Erreur fenêtre ${winLabel} : ${message}`);
      if (isRateLimitMax) {
        console.log(`[RateLimit][${tenantSlug}] Pause globale 60s`);
        await sleep(60_000);
      }
      try {
        await db.getaroundAccount.update({
          where: { id: accountId },
          data: { syncStatus: 'error', syncError: message },
        });
      } catch { /* ignore */ }
      // On reprendra depuis lastSyncAt au prochain cron
      break;
    }

    // Fenêtre précédente
    windowEnd = new Date(windowStart);
    windowStart = new Date(Math.max(
      windowEnd.getTime() - 30 * 86_400_000,
      absoluteStart.getTime(),
    ));

    await sleep(3_000);
  }

  console.log(`[Sync][${tenantSlug}] ═══ FIN SYNC ═══`);
  updateSyncState(tenantSlug, {
    isRunning: false,
    progress: 100,
    currentStep: 'Terminé',
    lastSyncResult: { created: result.created, updated: result.updated },
  });

  return result;
}

// ─── 3. Réponse IA automatique ───────────────────────────────────────────────

async function autoReplyToMessage(
  db: PrismaClient,
  ga: GetaroundClient,
  messageContent: string,
  rental: {
    id: string;
    getaroundId: string;
    driverName: string;
    startAt: Date;
    endAt: Date;
    vehicleId: string;
    vehicle: {
      make: string; model: string; licensePlate: string;
      year: number | null; color: string | null; fuelType: string | null;
      parkingZone: string | null;
      pickupInstructions: string | null;
      returnInstructions: string | null;
    };
    messages: Array<{ direction: string; content: string }>;
  },
  tenantSlug: string,
): Promise<void> {
  const settings = await db.companySettings.findFirst({
    select: {
      aiModeCarSeat: true, aiModeIncident: true, aiModeGeneral: true,
      aiTone: true, aiName: true, senderName: true,
    },
  });
  if (!settings) return;

  const tone = (settings.aiTone as 'vouvoiement' | 'tutoiement') ?? 'vouvoiement';
  const analysis = await analyzeMessage(messageContent);

  const context = {
    driverName: rental.driverName,
    vehicleMake: rental.vehicle.make,
    vehicleModel: rental.vehicle.model,
    vehicleYear: rental.vehicle.year ?? undefined,
    vehicleColor: rental.vehicle.color ?? undefined,
    fuelType: rental.vehicle.fuelType ?? undefined,
    licensePlate: rental.vehicle.licensePlate,
    parkingZone: rental.vehicle.parkingZone ?? undefined,
    pickupInstructions: rental.vehicle.pickupInstructions ?? undefined,
    returnInstructions: rental.vehicle.returnInstructions ?? undefined,
    startDate: new Date(rental.startAt).toLocaleDateString('fr-FR'),
    endDate: new Date(rental.endAt).toLocaleDateString('fr-FR'),
    companyName: settings.senderName ?? 'Sun and Drive',
    aiName: settings.aiName ?? undefined,
  };

  const admins = await db.user.findMany({
    where: { isActive: true, OR: [{ role: 'admin' }, { roles: { has: 'admin' } }] },
    select: { id: true },
  });

  const mode = analysis.isIncidentReport || analysis.needsHumanReply
    ? settings.aiModeIncident
    : analysis.isCarSeatRequest || analysis.isAccessoryRequest
    ? settings.aiModeCarSeat
    : settings.aiModeGeneral;

  if (mode === 'manual' || analysis.isUrgent || analysis.needsHumanReply) {
    await db.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        type: analysis.isUrgent ? 'urgent_message' : 'human_reply_needed',
        title: analysis.isUrgent ? '🚨 Message urgent' : '👤 Réponse humaine requise',
        body: `${rental.driverName} : ${messageContent.slice(0, 100)}`,
        relatedEntityId: rental.id,
        targetUrl: `/rentals/${rental.id}`,
      })),
      skipDuplicates: true,
    });
    return;
  }

  if (analysis.isCarSeatRequest) {
    const existing = await db.carSeatRequest.findFirst({
      where: { rentalId: rental.id, status: 'pending' },
    });
    if (!existing) {
      await db.carSeatRequest.create({
        data: { rentalId: rental.id, vehicleId: rental.vehicleId, status: 'pending' },
      });
    }
    await db.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        type: 'car_seat_request',
        title: '🪑 Demande de siège auto',
        body: `${rental.driverName} demande un siège auto`,
        relatedEntityId: rental.id,
        targetUrl: `/rentals/${rental.id}`,
      })),
      skipDuplicates: true,
    });
  }

  if (analysis.isAccessoryRequest && analysis.detectedAccessory) {
    await db.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        type: 'accessory_request',
        title: `🎒 Demande ${analysis.detectedAccessory}`,
        body: `${rental.driverName} demande ${analysis.detectedAccessory}`,
        relatedEntityId: rental.id,
        targetUrl: `/rentals/${rental.id}`,
      })),
      skipDuplicates: true,
    });
  }

  const reply = await suggestReply(messageContent, context, tone, rental.messages);

  if (reply.includes('Je transmets votre question')) {
    await db.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        type: 'ai_transfer',
        title: '❓ Question sans réponse IA',
        body: `${rental.driverName} : ${messageContent.slice(0, 100)}`,
        relatedEntityId: rental.id,
        targetUrl: `/rentals/${rental.id}`,
      })),
      skipDuplicates: true,
    });
  }

  if (mode === 'auto') {
    try {
      await ga.sendMessage(parseInt(rental.getaroundId, 10), reply);
      await db.message.create({
        data: {
          rentalId: rental.id,
          direction: 'outbound',
          content: reply,
          sentAt: new Date(),
          status: 'sent',
        },
      });
      console.log(`[IA][${tenantSlug}] Réponse auto envoyée pour rental ${rental.id}`);
    } catch (err) {
      console.error(`[IA][${tenantSlug}] Erreur envoi:`, err instanceof Error ? err.message : err);
    }
  } else {
    await db.message.create({
      data: {
        rentalId: rental.id,
        direction: 'outbound',
        content: reply,
        status: 'pending_approval',
        aiSuggestion: reply,
      },
    });
    await db.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        type: 'ai_draft',
        title: '✍️ Brouillon IA à approuver',
        body: `Réponse générée pour ${rental.driverName} — à valider`,
        relatedEntityId: rental.id,
        targetUrl: `/rentals/${rental.id}`,
      })),
      skipDuplicates: true,
    });
    console.log(`[IA][${tenantSlug}] Brouillon créé pour rental ${rental.id}`);
  }
}

// ─── 4. Messages (endpoint manuel) ──────────────────────────────────────────

export interface MessageSyncResult {
  accountId: string;
  created: number;
  skipped: number;
  errors: string[];
}

export async function syncAccountMessages(
  db: PrismaClient,
  accountId: string,
  tenantSlug = 'default',
): Promise<MessageSyncResult> {
  const account = await db.getaroundAccount.findUnique({ where: { id: accountId } });
  if (!account) throw Object.assign(new Error('Compte Getaround introuvable'), { status: 404 });

  const result: MessageSyncResult = { accountId, created: 0, skipped: 0, errors: [] };

  const apiKey = decrypt(account.apiKeyHash);
  const ga = createGetaroundClient(apiKey);

  // Sync les messages des locations actives/réservées + complétées depuis 7 jours max
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rentals = await db.rental.findMany({
    where: {
      vehicle: { getaroundAccountId: accountId },
      OR: [
        { status: { in: ['booked', 'active'] } },
        { status: 'completed', endAt: { gte: sevenDaysAgo } },
      ],
    },
    select: { id: true, getaroundId: true, driverGetaroundId: true, vehicleId: true, driverName: true, startAt: true, vehicle: { select: { make: true, model: true, licensePlate: true } } },
  });

  const totalRentals = await db.rental.count({ where: { vehicle: { getaroundAccountId: accountId } } });
  console.log(`[Sync][${tenantSlug}] Messages : ${rentals.length} locations actives à traiter (${totalRentals - rentals.length} locations terminées ignorées)`);

  for (const rental of rentals) {
    if (!rental.getaroundId) continue;
    const gaRentalId = parseInt(rental.getaroundId, 10);

    try {
      // /rentals/{rental_id}/messages.json → [{id}] puis /messages/{id}.json pour chaque
      const messages = await ga.getMessages(gaRentalId);

      for (const msg of messages) {
        try {
          // Direction : inbound si l'expéditeur est le conducteur (user_id du rental)
          const direction =
            rental.driverGetaroundId && String(msg.sending_user_id) === rental.driverGetaroundId
              ? ('inbound' as const)
              : ('outbound' as const);

          const upserted = await db.message.upsert({
            where: { getaroundId: String(msg.id) },
            create: {
              getaroundId: String(msg.id),
              rentalId: rental.id,
              direction,
              content: msg.content,
              sentAt: new Date(msg.sent_at),
              status: 'sent',
            },
            update: { content: msg.content },
            select: { id: true, createdAt: true },
          });
          const isNew = Date.now() - upserted.createdAt.getTime() < 10_000;
          if (isNew) result.created++;
          else result.skipped++;

          // Analyse IA + réponse automatique sur messages entrants nouveaux
          if (direction === 'inbound' && isNew) {
            const fullRental = await db.rental.findUnique({
              where: { id: rental.id },
              include: {
                vehicle: {
                  select: {
                    make: true, model: true, licensePlate: true,
                    year: true, color: true, fuelType: true,
                    parkingZone: true, pickupInstructions: true, returnInstructions: true,
                  },
                },
                messages: {
                  orderBy: { sentAt: 'asc' },
                  select: { direction: true, content: true },
                  take: 10,
                },
              },
            });

            if (fullRental) {
              void autoReplyToMessage(db, ga, msg.content, fullRental, tenantSlug)
                .catch(e => console.error('[IA] autoReply error:', e));
            }
          }

          void upserted; // référence utilisée ci-dessus
        } catch (err: unknown) {
          result.errors.push(`Message ${msg.id}: ${err instanceof Error ? err.message : 'erreur'}`);
        }
      }
    } catch (err: unknown) {
      result.errors.push(`Rental ${rental.getaroundId}: ${err instanceof Error ? err.message : 'erreur'}`);
    }

    await sleep(500); // toujours exécuté, même en cas d'erreur
  }

  return result;
}

// ─── 4. Factures + virements ────────────────────────────────────────────────

export async function syncAccountInvoicesPayouts(db: PrismaClient, accountId: string): Promise<void> {
  const account = await db.getaroundAccount.findUnique({ where: { id: accountId } });
  if (!account) return;
  const apiKey = decrypt(account.apiKeyHash);
  const ga = createGetaroundClient(apiKey);

  const [invoices, payouts] = await Promise.allSettled([ga.getInvoices(), ga.getPayoutsAll()]);

  if (invoices.status === 'fulfilled') {
    for (const inv of invoices.value) {
      const rentalDb = inv.rental_id
        ? await db.rental.findUnique({ where: { getaroundId: String(inv.rental_id) }, select: { id: true } })
        : null;
      await db.getaroundInvoice.upsert({
        where: { getaroundId: inv.id },
        create: {
          getaroundId: inv.id,
          pdfUrl: inv.pdf_url,
          totalPrice: inv.total_price,
          currency: inv.currency ?? 'EUR',
          emittedAt: inv.emitted_at ? new Date(inv.emitted_at) : null,
          rentalId: rentalDb?.id ?? null,
        },
        update: {
          pdfUrl: inv.pdf_url,
          emittedAt: inv.emitted_at ? new Date(inv.emitted_at) : null,
          rentalId: rentalDb?.id ?? null,
        },
      });
    }
  }

  if (payouts.status === 'fulfilled') {
    for (const pay of payouts.value) {
      await db.getaroundPayout.upsert({
        where: { getaroundId: pay.id },
        create: {
          getaroundId: pay.id,
          amount: pay.amount,
          currency: pay.currency ?? 'EUR',
          completedAt: pay.completed_at ? new Date(pay.completed_at) : null,
        },
        update: {
          completedAt: pay.completed_at ? new Date(pay.completed_at) : null,
        },
      });
    }
  }
}

// ─── 5. Analyse one-shot des messages existants ─────────────────────────────

export async function analyzeExistingMessages(db: PrismaClient, tenantSlug = 'default'): Promise<void> {
  const messages = await db.message.findMany({
    where: {
      direction: 'inbound',
      OR: [
        { aiAnalysis: { equals: Prisma.JsonNull } },
        { aiAnalysis: { equals: Prisma.DbNull } },
      ],
    },
    select: { id: true, content: true, rentalId: true },
    take: 200,
    orderBy: { createdAt: 'desc' },
  });

  console.log(`[IA][${tenantSlug}] Analyse de ${messages.length} messages historiques`);
  let carSeatFound = 0;

  for (const msg of messages) {
    try {
      const analysis = await analyzeMessage(msg.content);
      await db.message.update({
        where: { id: msg.id },
        data: { aiAnalysis: analysis as never },
      });

      if (analysis.isCarSeatRequest) {
        const existing = await db.carSeatRequest.findFirst({
          where: { rentalId: msg.rentalId, status: 'pending' },
        });
        if (!existing) {
          const rental = await db.rental.findUnique({
            where: { id: msg.rentalId },
            select: { vehicleId: true },
          });
          if (rental) {
            await db.carSeatRequest.create({
              data: { rentalId: msg.rentalId, vehicleId: rental.vehicleId, status: 'pending' },
            });
            carSeatFound++;
          }
        }
      }

      await sleep(500);
    } catch (err) {
      console.error(`[IA] Erreur analyse message ${msg.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[IA][${tenantSlug}] Terminé — ${carSeatFound} siège(s) auto détecté(s)`);
}

// ─── 6. Correction historique kilométrage ────────────────────────────────────

export async function fixHistoricalMileage(db: PrismaClient): Promise<{ corrected: number }> {
  const rentals = await db.rental.findMany({
    where: {
      OR: [{ startMileage: { gt: 0 } }, { endMileage: { gt: 0 } }],
    },
    select: {
      id: true,
      getaroundId: true,
      vehicleId: true,
    },
  });

  // Regrouper par compte pour réutiliser le client API
  const byAccount = new Map<string, Array<{ id: string; getaroundId: string | null; vehicleId: string }>>();
  for (const r of rentals) {
    if (!r.getaroundId) continue;
    const vehicle = await db.vehicle.findUnique({
      where: { id: r.vehicleId },
      select: { getaroundAccountId: true },
    });
    const accId = vehicle?.getaroundAccountId;
    if (!accId) continue;
    if (!byAccount.has(accId)) byAccount.set(accId, []);
    byAccount.get(accId)!.push(r);
  }

  let corrected = 0;

  for (const [accountId, accountRentals] of byAccount) {
    const account = await db.getaroundAccount.findUnique({ where: { id: accountId } });
    if (!account) continue;
    const apiKey = decrypt(account.apiKeyHash);
    const ga = createGetaroundClient(apiKey);

    for (const rental of accountRentals) {
      const gaId = parseInt(rental.getaroundId!, 10);
      const updateData: Record<string, unknown> = {};

      try {
        const checkin = await ga.getCheckin(gaId);
        await sleep(300);
        if (checkin.mileage != null) updateData.startMileage = Math.round(checkin.mileage);
        if (checkin.fuel_level != null) updateData.fuelLevelCheckin = checkin.fuel_level;
      } catch { /* location sans checkin */ }

      try {
        const checkout = await ga.getCheckout(gaId);
        await sleep(300);
        if (checkout.mileage != null) updateData.endMileage = Math.round(checkout.mileage);
        if (checkout.distance_driven != null) updateData.kmDriven = Math.round(checkout.distance_driven);
        if (checkout.fuel_level != null) updateData.fuelLevelCheckout = checkout.fuel_level;
      } catch { /* location sans checkout */ }

      if (Object.keys(updateData).length > 0) {
        await db.rental.update({ where: { id: rental.id }, data: updateData });
        corrected++;
      }

      await sleep(500);
    }
  }

  console.log(`[FixMileage] ${corrected} locations corrigées`);
  return { corrected };
}

// ─── 7. Sync virements par fenêtre ──────────────────────────────────────────

export async function syncPayoutsForWindow(
  db: PrismaClient,
  ga: GetaroundClient,
  windowStart: Date,
  windowEnd: Date,
  tenantSlug: string,
): Promise<{ updated: number; errors: number }> {
  const result = { updated: 0, errors: 0 };

  try {
    console.log('[Payouts] URL appelée avec start:', windowStart.toISOString(), 'end:', windowEnd.toISOString());
    const payouts = await ga.getPayouts(windowStart, windowEnd);
    console.log('[Payouts] Résultat:', JSON.stringify(payouts));
    console.log(`[Sync][${tenantSlug}] Payouts : ${payouts.length} payout(s)`);

    for (const p of payouts) {
      const payout = await ga.getPayout(p.id);
      await sleep(500);

      for (const inv of payout.invoices) {
        try {
          const invoice = await ga.getInvoice(inv.id);
          await sleep(300);

          if (invoice.product_type !== 'Rental') continue;

          const rental = await db.rental.findFirst({
            where: { getaroundId: String(invoice.product_id) },
          });
          if (!rental) continue;

          let basePrice = 0, insuranceFee = 0, extraDistanceFee = 0;
          let driverMessFee = 0, damageCompensation = 0, lateReturnFee = 0;
          let gasRefillFee = 0, deliveryFee = 0, assistanceFee = 0;

          for (const charge of invoice.charges) {
            const amount = charge.amount / 100;
            switch (charge.type) {
              case 'driver_rental_payment':
                basePrice += amount; break;
              case 'self_insurance_payment':
              case 'additional_self_insurance_payment':
              case 'mileage_package_insurance':
                insuranceFee += amount; break;
              case 'extra_distance_payment':
              case 'mileage_package':
                extraDistanceFee += amount; break;
              case 'driver_mess_fee':
              case 'drivy_mess_fee':
                driverMessFee += Math.abs(amount); break;
              case 'damage_compensation':
                damageCompensation += Math.abs(amount); break;
              case 'driver_late_return_fee':
              case 'drivy_late_return_fee':
                lateReturnFee += Math.abs(amount); break;
              case 'driver_gas_refill_fee':
              case 'driver_gas_compensation':
                gasRefillFee += Math.abs(amount); break;
              case 'delivery_fee':
                deliveryFee += amount; break;
              case 'assistance_fee':
                assistanceFee += amount; break;
            }
          }

          const grossRevenue = Math.round((
            basePrice + insuranceFee + extraDistanceFee +
            driverMessFee + damageCompensation + lateReturnFee +
            gasRefillFee + deliveryFee + assistanceFee
          ) * 100) / 100;

          const ownerPayout = Math.round(
            Math.abs(invoice.total_price) / 100 * 100,
          ) / 100;

          await db.rental.update({
            where: { id: rental.id },
            data: {
              basePrice:          basePrice          || undefined,
              insuranceFee:       insuranceFee       || undefined,
              extraDistanceFee:   extraDistanceFee   || undefined,
              driverMessFee:      driverMessFee      || undefined,
              damageCompensation: damageCompensation || undefined,
              lateReturnFee:      lateReturnFee      || undefined,
              gasRefillFee:       gasRefillFee       || undefined,
              deliveryFee:        deliveryFee        || undefined,
              assistanceFee:      assistanceFee      || undefined,
              grossRevenue:       grossRevenue       || undefined,
              ownerPayout:        ownerPayout        || undefined,
            },
          });
          result.updated++;

        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Sync][${tenantSlug}] Erreur invoice ${inv.id}: ${msg}`);
          result.errors++;
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Payouts] ERREUR PRINCIPALE:', err);
    console.error(`[Sync][${tenantSlug}] Erreur sync payouts: ${msg}`);
  }

  console.log(`[Sync][${tenantSlug}] Payouts : ${result.updated} location(s) mises à jour`);
  return result;
}

export async function recalculateHistoricalPayouts(db: PrismaClient, tenantSlug = 'default'): Promise<void> {
  console.log('[Payouts] Démarrage recalcul historique');
  const accounts = await db.getaroundAccount.findMany({
    where: { isActive: true },
    select: { id: true, apiKeyHash: true },
  });
  console.log('[Payouts] Nb comptes actifs:', accounts.length);

  const now = new Date();
  const twoYearsAgo = new Date(now.getTime() - 24 * 30 * 86_400_000);

  for (const account of accounts) {
    const apiKey = decrypt(account.apiKeyHash);
    const ga = createGetaroundClient(apiKey);

    let windowEnd = new Date(now);
    while (windowEnd > twoYearsAgo) {
      const windowStart = new Date(Math.max(
        windowEnd.getTime() - 30 * 86_400_000,
        twoYearsAgo.getTime(),
      ));
      console.log('[Payouts] Fenêtre:', windowStart.toISOString().slice(0, 10), '->', windowEnd.toISOString().slice(0, 10));
      await syncPayoutsForWindow(db, ga, windowStart, windowEnd, tenantSlug);
      windowEnd = new Date(windowStart);
      await sleep(2_000);
    }
  }

  console.log(`[RecalcPayouts][${tenantSlug}] Terminé`);
}

// ─── Gestion des comptes Getaround ──────────────────────────────────────────

export async function listAccounts(db: PrismaClient) {
  return db.getaroundAccount.findMany({
    where: { isActive: true },
    include: { _count: { select: { vehicles: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createAccount(db: PrismaClient, name: string, apiKey: string) {
  const apiKeyHash = encrypt(apiKey);
  return db.getaroundAccount.create({ data: { name, apiKeyHash } });
}

export async function updateAccountKey(db: PrismaClient, id: string, apiKey: string) {
  const apiKeyHash = encrypt(apiKey);
  return db.getaroundAccount.update({ where: { id }, data: { apiKeyHash } });
}

export async function deleteAccount(db: PrismaClient, id: string) {
  return db.getaroundAccount.update({ where: { id }, data: { isActive: false } });
}
