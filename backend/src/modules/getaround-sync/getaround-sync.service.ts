import type { PrismaClient } from '../../generated/tenant';
import { decrypt, encrypt } from '../../utils/crypto';
import { createGetaroundClient, type GetaroundRental } from './getaround-api';
import { scheduleSequencesForRental } from '../sequences/sequences.service';

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
      } catch (err) {
        result.errors.push(`Voiture ${car.id}: ${err instanceof Error ? err.message : 'erreur'}`);
      }
    }

    await db.getaroundAccount.update({
      where: { id: accountId },
      data: { syncStatus: 'success', lastSyncAt: new Date(), syncError: null },
    });
  } catch (err) {
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
): Promise<Array<{ vehicles: SyncResult; rentals: RentalSyncResult; messages: MessageSyncResult }>> {
  const accounts = await db.getaroundAccount.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  const results = [];
  for (const a of accounts) {
    const vehicles = await syncAccountVehicles(db, a.id);
    const rentals  = await syncAccountRentals(db, a.id);
    const messages = await syncAccountMessages(db, a.id);
    results.push({ vehicles, rentals, messages });
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
): Promise<RentalSyncResult> {
  const account = await db.getaroundAccount.findUnique({ where: { id: accountId } });
  if (!account) throw Object.assign(new Error('Compte Getaround introuvable'), { status: 404 });

  const result: RentalSyncResult = { accountId, created: 0, updated: 0, errors: [] };

  const apiKey = decrypt(account.apiKeyHash);
  const ga = createGetaroundClient(apiKey);

  // Par défaut : lastSyncAt - 2h si déjà syncé, sinon 2 ans en arrière
  // getRentals découpe automatiquement en fenêtres ≤ 30 jours
  const startDate = from ?? (
    account.lastSyncAt != null
      ? new Date(account.lastSyncAt.getTime() - 2 * 3_600_000)
      : new Date(Date.now() - 2 * 365 * 86_400_000)
  );
  const defaultEnd = new Date();
  defaultEnd.setMonth(defaultEnd.getMonth() + 3);
  const endDate = to ?? defaultEnd;

  const rentals = await ga.getRentals(startDate, endDate);

  // Cache conducteurs : évite un appel API par location pour le même conducteur
  const userCache = new Map<number, string>();

  for (const r of rentals) {
    try {
      // Liaison au véhicule via car_id Getaround
      const vehicle = await db.vehicle.findUnique({
        where: { getaroundId: String(r.car_id) },
        select: { id: true, currentMileage: true },
      });

      if (!vehicle) {
        result.errors.push(`Location ${r.id}: véhicule ${r.car_id} non trouvé en base`);
        continue;
      }

      // Nom du conducteur via /users/{id}.json (mis en cache par user_id)
      if (!userCache.has(r.user_id)) {
        try {
          const user = await ga.getUser(r.user_id);
          userCache.set(r.user_id, `${user.first_name} ${user.last_name}`);
        } catch (err) {
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
        select: { id: true, status: true, startMileage: true, endMileage: true },
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

      // Kilométrage depuis checkin/checkout — l'API retourne des dixièmes de km
      // On ne refetch que si la valeur n'est pas encore stockée
      if (newStatus !== 'booked' && existingRental?.startMileage == null) {
        try {
          const checkin = await ga.getCheckin(r.id);
          if (checkin.mileage != null) {
            await db.rental.update({
              where: { id: upserted.id },
              data: { startMileage: Math.round(checkin.mileage / 1000) },
            });
          }
        } catch (err) { console.error(`[Sync Checkin] rental=${r.id}`, err); }
      }

      if (newStatus === 'completed' && existingRental?.endMileage == null) {
        try {
          const checkout = await ga.getCheckout(r.id);
          const mileageData: { endMileage?: number; kmDriven?: number } = {};
          if (checkout.mileage != null) {
            mileageData.endMileage = Math.round(checkout.mileage / 1000);
            // Mettre à jour le compteur du véhicule si la valeur progresse
            const newOdometer = mileageData.endMileage;
            if (newOdometer > vehicle.currentMileage) {
              await db.vehicle.update({
                where: { id: vehicle.id },
                data: { currentMileage: newOdometer },
              });
            }
          }
          if (checkout.distance_driven != null) mileageData.kmDriven = Math.round(checkout.distance_driven / 1000);
          if (Object.keys(mileageData).length > 0) {
            await db.rental.update({ where: { id: upserted.id }, data: mileageData });
          }
        } catch (err) { console.error(`[Sync Checkout] rental=${r.id}`, err); }
      }
    } catch (err) {
      result.errors.push(`Location ${r.id}: ${err instanceof Error ? err.message : 'erreur'}`);
    }
  }

  await db.getaroundAccount.update({
    where: { id: accountId },
    data: { lastSyncAt: new Date() },
  });

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

  // Sync les messages des locations actives/réservées + complétées depuis 30 jours
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rentals = await db.rental.findMany({
    where: {
      vehicle: { getaroundAccountId: accountId },
      OR: [
        { status: { in: ['booked', 'active'] } },
        { endAt: { gte: since } },
      ],
    },
    select: { id: true, getaroundId: true, driverGetaroundId: true },
  });

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

          await db.message.create({
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
        } catch (err) {
          result.errors.push(`Message ${msg.id}: ${err instanceof Error ? err.message : 'erreur'}`);
        }
      }
    } catch (err) {
      result.errors.push(`Rental ${rental.getaroundId}: ${err instanceof Error ? err.message : 'erreur'}`);
    }
  }

  return result;
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
