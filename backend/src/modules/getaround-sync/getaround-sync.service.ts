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

export async function syncAllAccounts(db: PrismaClient): Promise<SyncResult[]> {
  const accounts = await db.getaroundAccount.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  return Promise.all(accounts.map((a) => syncAccountVehicles(db, a.id)));
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

  // Par défaut : 2 ans en arrière → 1 an en avant
  // start_date et end_date envoyés en string ISO8601 via .toISOString() — pas d'erreur 422
  // getRentals découpe automatiquement en fenêtres ≤ 30 jours
  const startDate = from ?? new Date(Date.now() - 2 * 365 * 86_400_000);
  const endDate = to ?? new Date(Date.now() + 365 * 86_400_000);

  const rentals = await ga.getRentals(startDate, endDate);

  // Cache conducteurs : évite un appel API par location pour le même conducteur
  const userCache = new Map<number, string>();

  for (const r of rentals) {
    try {
      // Liaison au véhicule via car_id Getaround
      const vehicle = await db.vehicle.findUnique({
        where: { getaroundId: String(r.car_id) },
        select: { id: true },
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
        } catch {
          userCache.set(r.user_id, `Conducteur ${r.user_id}`);
        }
      }
      const driverName = userCache.get(r.user_id)!;

      // Status inféré depuis les dates (l'API ne retourne pas de champ state)
      const status = inferStatus(r);
      // price est en centimes → convertir en euros
      const grossRevenue = r.price / 100;

      // Vérifier le statut existant pour ne pas écraser un 'cancelled' manuel
      const existingRental = await db.rental.findUnique({
        where: { getaroundId: String(r.id) },
        select: { id: true, status: true },
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

      if (!existingRental) {
        result.created++;
        if (status === 'booked') {
          void scheduleSequencesForRental(db, upserted.id, 'rental.booked').catch(console.error);
        }
      } else {
        result.updated++;
        if (prevStatus === 'booked' && newStatus === 'active') {
          void scheduleSequencesForRental(db, upserted.id, 'rental.car_checked_in').catch(console.error);
        } else if (prevStatus === 'active' && newStatus === 'completed') {
          void scheduleSequencesForRental(db, upserted.id, 'rental.car_checked_out').catch(console.error);
        }
      }
    } catch (err) {
      result.errors.push(`Location ${r.id}: ${err instanceof Error ? err.message : 'erreur'}`);
    }
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
