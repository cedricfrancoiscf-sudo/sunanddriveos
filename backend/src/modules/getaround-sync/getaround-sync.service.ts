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
        const existing = await db.vehicle.findUnique({
          where: { getaroundId: String(car.id) },
        });

        // Champs disponibles dans l'API : id, state, plate_number, brand, model, address
        // Pas de year, color, picture_url, mileage dans l'API Owner v1
        const vehicleData = {
          getaroundId: String(car.id),
          getaroundAccountId: accountId,
          make: car.brand,
          model: car.model,
          isActive: car.state === 'active',
          ...(car.plate_number ? { licensePlate: car.plate_number.toUpperCase() } : {}),
        };

        if (existing) {
          await db.vehicle.update({ where: { id: existing.id }, data: vehicleData });
          result.updated++;
        } else {
          await db.vehicle.create({
            data: {
              ...vehicleData,
              licensePlate: car.plate_number?.toUpperCase() ?? `GA-${car.id}`,
              year: 0, // non fourni par l'API Getaround
            },
          });
          result.created++;
        }
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
  // getRentals découpe automatiquement en fenêtres ≤ 30 jours
  const startDate = from ?? new Date(Date.now() - 2 * 365 * 86_400_000);
  const endDate = to ?? new Date(Date.now() + 365 * 86_400_000);

  const rentals = await ga.getRentals(startDate, endDate);

  // Cache conducteurs : évite un appel API par location pour le même conducteur
  const userCache = new Map<number, string>();

  for (const r of rentals) {
    try {
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

      const existing = await db.rental.findUnique({
        where: { getaroundId: String(r.id) },
      });

      if (existing) {
        const prevStatus = existing.status;
        // Ne pas écraser un statut 'cancelled' positionné manuellement
        const newStatus = existing.status === 'cancelled' ? 'cancelled' : status;
        await db.rental.update({
          where: { id: existing.id },
          data: {
            vehicleId: vehicle.id,
            driverName,
            driverGetaroundId: String(r.user_id),
            startAt: new Date(r.starts_at),
            endAt: new Date(r.ends_at),
            grossRevenue,
            status: newStatus,
          },
        });
        result.updated++;
        if (prevStatus === 'booked' && newStatus === 'active') {
          void scheduleSequencesForRental(db, existing.id, 'rental.car_checked_in').catch(console.error);
        } else if (prevStatus === 'active' && newStatus === 'completed') {
          void scheduleSequencesForRental(db, existing.id, 'rental.car_checked_out').catch(console.error);
        }
      } else {
        const created = await db.rental.create({
          data: {
            getaroundId: String(r.id),
            vehicleId: vehicle.id,
            driverName,
            driverEmail: null,
            driverGetaroundId: String(r.user_id),
            startAt: new Date(r.starts_at),
            endAt: new Date(r.ends_at),
            grossRevenue,
            status,
          },
        });
        result.created++;
        if (status === 'booked') {
          void scheduleSequencesForRental(db, created.id, 'rental.booked').catch(console.error);
        }
      }
    } catch (err) {
      result.errors.push(`Location ${r.id}: ${err instanceof Error ? err.message : 'erreur'}`);
    }
  }

  return result;
}

// --- Gestion des comptes Getaround ---

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
