import type { PrismaClient } from '../../generated/tenant';
import { decrypt, encrypt } from '../../utils/crypto';
import { createGetaroundClient, type GetaroundRental } from './getaround-api';
import { scheduleSequencesForRental } from '../sequences/sequences.service';
import { analyzeMessage } from '../ai/ai.service';
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
      data: { syncStatus: 'success', lastSyncAt: new Date(), syncError: null },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
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
  const accounts = await db.getaroundAccount.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  const results = [];
  try {
    for (const a of accounts) {
      const vehicles = await syncAccountVehicles(db, a.id);
      const rentals = await syncAccountRentals(db, a.id, undefined, undefined, tenantSlug);
      updateSyncState(tenantSlug, { progress: 80, currentStep: 'Synchronisation des messages...' });
      const messages = await syncAccountMessages(db, a.id);
      updateSyncState(tenantSlug, { progress: 90, currentStep: 'Synchronisation des factures...' });
      void syncAccountInvoicesPayouts(db, a.id).catch(e => console.error('[Sync] Erreur invoices/payouts:', e));
      results.push({ vehicles, rentals, messages });
    }
    const totalCreated = results.reduce((s, r) => s + r.vehicles.created + r.rentals.created, 0);
    const totalUpdated = results.reduce((s, r) => s + r.vehicles.updated + r.rentals.updated, 0);
    updateSyncState(tenantSlug, {
      isRunning: false, progress: 100, currentStep: 'Terminé',
      lastSyncAt: new Date(), lastSyncResult: { created: totalCreated, updated: totalUpdated },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    updateSyncState(tenantSlug, { isRunning: false, error: msg, progress: 0 });
    throw err;
  }
  return results;
}

// ─── 2. Locations ───────────────────────────────────────────────────────────

export interface RentalSyncResult {
  accountId: string;
  created: number;
  updated: number;
  errors: string[];
}

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

  // Par défaut : lastSyncAt - 2h si déjà syncé, sinon 2 ans en arrière
  // getRentals découpe automatiquement en fenêtres ≤ 30 jours
  let startDate = from ?? (
    account.lastSyncAt != null
      ? new Date(account.lastSyncAt.getTime() - 2 * 3_600_000)
      : new Date(Date.now() - 2 * 365 * 86_400_000)
  );
  const defaultEnd = new Date();
  defaultEnd.setMonth(defaultEnd.getMonth() + 3);
  const endDate = to ?? defaultEnd;

  // Mode trial : limiter la sync aux 90 derniers jours
  if (tenantSlug !== 'default') {
    try {
      const masterDb = getMasterClient();
      const company = await masterDb.company.findFirst({ where: { slug: tenantSlug } });
      const trialActive = company?.trialEndsAt != null && company.trialEndsAt > new Date() && !company.stripeSubscriptionId;
      if (trialActive) {
        startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        console.log('[Sync] Mode trial — sync limitée aux 90 derniers jours');
        updateSyncState(tenantSlug, { isTrialLimited: true });
      }
    } catch (e) { console.error('[Sync] Erreur vérification trial:', e); }
  }

  updateSyncState(tenantSlug, { progress: 15, currentStep: 'Récupération des locations...' });

  const rentals = await ga.getRentals(startDate, endDate);
  updateSyncState(tenantSlug, { totalItems: rentals.length, processedItems: 0 });

  // Cache conducteurs : évite un appel API par location pour le même conducteur
  const userCache = new Map<number, string>();
  let processedItems = 0;
  let syncCompleted = true;

  for (const r of rentals) {
    try {
      // Liaison au véhicule via car_id Getaround
      const vehicle = await db.vehicle.findUnique({
        where: { getaroundId: String(r.car_id) },
        select: { id: true, currentMileage: true, make: true, model: true, licensePlate: true },
      });

      if (!vehicle) {
        result.errors.push(`Location ${r.id}: véhicule ${r.car_id} non trouvé en base`);
        continue;
      }

      // Nom du conducteur via /users/{id}.json (mis en cache par user_id)
      if (!userCache.has(r.user_id)) {
        try {
          const user = await ga.getUser(r.user_id);
          await sleep(300);
          userCache.set(r.user_id, `${user.first_name} ${user.last_name}`);
        } catch (err: unknown) {
          console.error(`[Sync User] user_id=${r.user_id}`, err);
          userCache.set(r.user_id, `Conducteur ${r.user_id}`);
        }
      }
      const driverName = userCache.get(r.user_id)!;

      // Status inféré depuis les dates (l'API ne retourne pas de champ state)
      const status = inferStatus(r);
      // price est en centimes → convertir en euros
      const grossRevenue = r.price / 100;

      // Vérifier le statut existant pour ne pas écraser un 'cancelled' manuel
      // startMileage/endMileage : pour éviter des appels checkin/checkout redondants
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
        create: {
          ...commonData,
          getaroundId: String(r.id),
          driverEmail: null,
          status,
        },
        update: {
          ...commonData,
          status: newStatus,
        },
        select: { id: true },
      });

      console.log('[Sync] Location sauvegardée:', r.id);
      if (!existingRental) {
        result.created++;
        if (status === 'booked') {
          void scheduleSequencesForRental(db, upserted.id, 'rental.booked').catch(console.error);
          // Telegram — nouvelle réservation
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
        // Alerte si le locataire est blacklisté
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

      // Kilométrage + carburant depuis checkin/checkout
      if (newStatus !== 'booked' && existingRental?.startMileage == null) {
        try {
          const checkin = await ga.getCheckin(r.id);
          await sleep(300);
          const checkinData: Record<string, unknown> = {};
          // API Getaround retourne le kilométrage en km directement
          if (checkin.mileage != null) checkinData.startMileage = Math.round(checkin.mileage);
          if (checkin.fuel_level != null) checkinData.fuelLevelCheckin = checkin.fuel_level;
          if (Object.keys(checkinData).length > 0) {
            await db.rental.update({ where: { id: upserted.id }, data: checkinData });
          }
        } catch (err: unknown) { console.error(`[Sync Checkin] rental=${r.id}`, err); }
      }

      if (newStatus === 'completed' && existingRental?.endMileage == null) {
        try {
          const checkout = await ga.getCheckout(r.id);
          await sleep(300);
          const checkoutData: Record<string, unknown> = {};
          if (checkout.mileage != null) {
            checkoutData.endMileage = Math.round(checkout.mileage); // API Getaround retourne le kilométrage en km directement
            const newOdometer = checkoutData.endMileage as number;
            if (newOdometer > vehicle.currentMileage) {
              await db.vehicle.update({ where: { id: vehicle.id }, data: { currentMileage: newOdometer } });
            }
          }
          if (checkout.distance_driven != null) checkoutData.kmDriven = Math.round(checkout.distance_driven); // API Getaround retourne le kilométrage en km directement
          if (checkout.fuel_level != null) checkoutData.fuelLevelCheckout = checkout.fuel_level;
          if (Object.keys(checkoutData).length > 0) {
            await db.rental.update({ where: { id: upserted.id }, data: checkoutData });
          }

          // Alerte carburant insuffisant : niveau retour < 25% (fuel_level est un décimal 0-1)
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
        } catch (err: unknown) { console.error(`[Sync Checkout] rental=${r.id}`, err); }
      }
    } catch (err: unknown) {
      result.errors.push(`Location ${r.id}: ${err instanceof Error ? err.message : 'erreur'}`);
      const httpStatus = (err as { response?: { status?: number } }).response?.status;
      if (httpStatus === 429) syncCompleted = false;
    }
    processedItems++;
    if (processedItems % 50 === 0 && rentals.length > 0) {
      console.log(`[Sync] ${processedItems}/${rentals.length} locations (${Math.round(processedItems / rentals.length * 100)}%)`);
    }
    updateSyncState(tenantSlug, {
      processedItems,
      progress: Math.round(15 + (processedItems / Math.max(rentals.length, 1)) * 65),
    });
    await sleep(500);
  }

  if (syncCompleted) {
    await db.getaroundAccount.update({
      where: { id: accountId },
      data: { lastSyncAt: new Date() },
    });
  } else {
    console.warn('[Sync] lastSyncAt non mis à jour — rate limit 429 non récupéré');
  }

  return result;
}

// ─── 3. Messages ────────────────────────────────────────────────────────────

export interface MessageSyncResult {
  accountId: string;
  created: number;
  skipped: number;
  errors: string[];
}

export async function syncAccountMessages(
  db: PrismaClient,
  accountId: string,
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
  console.log(`[Sync] Messages : ${rentals.length} locations actives à traiter (${totalRentals - rentals.length} locations terminées ignorées)`);

  for (const rental of rentals) {
    if (!rental.getaroundId) continue;
    const gaRentalId = parseInt(rental.getaroundId, 10);

    try {
      // /rentals/{rental_id}/messages.json → [{id}] puis /messages/{id}.json pour chaque
      const messages = await ga.getMessages(gaRentalId);

      for (const msg of messages) {
        try {
          const existing = await db.message.findUnique({
            where: { getaroundId: String(msg.id) },
            select: { id: true },
          });
          if (existing) { result.skipped++; continue; }

          // Direction : inbound si l'expéditeur est le conducteur (user_id du rental)
          const direction =
            rental.driverGetaroundId && String(msg.sending_user_id) === rental.driverGetaroundId
              ? ('inbound' as const)
              : ('outbound' as const);

          const created = await db.message.create({
            data: {
              getaroundId: String(msg.id),
              rentalId: rental.id,
              direction,
              content: msg.content,
              sentAt: new Date(msg.sent_at),
              status: 'sent', // déjà envoyé côté Getaround
            },
          });
          result.created++;

          // Détection siège auto sur messages entrants nouvellement créés
          if (direction === 'inbound') {
            void (async () => {
              try {
                const analysis = await analyzeMessage(msg.content);
                if (!analysis.isCarSeatRequest) return;

                const existing = await db.carSeatRequest.findFirst({ where: { rentalId: rental.id } });
                if (existing) return;

                await db.carSeatRequest.create({
                  data: { vehicleId: rental.vehicleId, rentalId: rental.id },
                });

                const vehicleLabel = `${rental.vehicle.make} ${rental.vehicle.model} (${rental.vehicle.licensePlate})`;
                const startLabel = rental.startAt.toLocaleDateString('fr-FR');

                // Notifier admins + carkeepers du véhicule
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
                // Telegram siège auto
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

          void created; // référence utilisée ci-dessus
        } catch (err: unknown) {
          result.errors.push(`Message ${msg.id}: ${err instanceof Error ? err.message : 'erreur'}`);
        }
      }
    } catch (err: unknown) {
      result.errors.push(`Rental ${rental.getaroundId}: ${err instanceof Error ? err.message : 'erreur'}`);
    }
  }

  return result;
}

// ─── 4. Factures + virements ────────────────────────────────────────────────

export async function syncAccountInvoicesPayouts(db: PrismaClient, accountId: string): Promise<void> {
  const account = await db.getaroundAccount.findUnique({ where: { id: accountId } });
  if (!account) return;
  const apiKey = decrypt(account.apiKeyHash);
  const ga = createGetaroundClient(apiKey);

  const [invoices, payouts] = await Promise.allSettled([ga.getInvoices(), ga.getPayouts()]);

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

export async function analyzeExistingMessages(db: PrismaClient): Promise<{ analyzed: number; detected: number }> {
  const messages = await db.message.findMany({
    where: {
      direction: 'inbound',
      rental: { carSeatRequests: { none: {} } },
    },
    select: {
      id: true,
      content: true,
      rentalId: true,
      rental: {
        select: {
          vehicleId: true,
          driverName: true,
          startAt: true,
          vehicle: { select: { make: true, model: true, licensePlate: true } },
        },
      },
    },
  });

  let analyzed = 0;
  let detected = 0;

  for (const msg of messages) {
    try {
      const analysis = await analyzeMessage(msg.content);
      analyzed++;

      if (analysis.isCarSeatRequest) {
        const existing = await db.carSeatRequest.findFirst({ where: { rentalId: msg.rentalId } });
        if (!existing) {
          await db.carSeatRequest.create({
            data: { vehicleId: msg.rental.vehicleId, rentalId: msg.rentalId },
          });
          const vehicleLabel = `${msg.rental.vehicle.make} ${msg.rental.vehicle.model} (${msg.rental.vehicle.licensePlate})`;
          const startLabel = msg.rental.startAt.toLocaleDateString('fr-FR');
          const [admins, carkeepers] = await Promise.all([
            db.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } }),
            db.vehicleCarkeeper.findMany({ where: { vehicleId: msg.rental.vehicleId }, select: { userId: true } }),
          ]);
          const recipientIds = [...new Set([...admins.map(a => a.id), ...carkeepers.map(c => c.userId)])];
          await db.notification.createMany({
            data: recipientIds.map(userId => ({
              userId,
              type: 'car_seat_request',
              title: `🪑 Siège auto demandé par ${msg.rental.driverName} pour ${vehicleLabel} le ${startLabel}`,
              body: `Message : ${msg.content.slice(0, 120)}`,
              relatedEntityType: 'rental',
              relatedEntityId: msg.rentalId,
            })),
            skipDuplicates: true,
          });
          detected++;
        }
      }

      await new Promise<void>(resolve => setTimeout(resolve, 500));
    } catch (e) {
      console.error(`[Analyse] Message ${msg.id}:`, e);
    }
  }

  console.log(`[Analyse] ${analyzed} messages analysés, ${detected} sièges détectés`);
  return { analyzed, detected };
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
