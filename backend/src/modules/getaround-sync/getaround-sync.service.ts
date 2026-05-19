import type { PrismaClient } from '../../generated/tenant';
import { decrypt, encrypt } from '../../utils/crypto';
import { createGetaroundClient } from './getaround-api';
import { scheduleSequencesForRental } from '../sequences/sequences.service';

export interface SyncResult {
  accountId: string;
  accountName: string;
  created: number;
  updated: number;
  errors: string[];
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
    const cars = await ga.getCars();

    for (const car of cars) {
      try {
        const existing = await db.vehicle.findUnique({
          where: { getaroundId: String(car.id) },
        });

        const vehicleData = {
          getaroundId: String(car.id),
          getaroundAccountId: accountId,
          make: car.brand,
          model: car.model,
          year: car.year_of_production,
          color: car.color ?? null,
          photoUrl: car.picture_url ?? null,
          currentMileage: car.mileage ?? 0,
          isActive: car.status !== 'inactive',
          // licensePlate est obligatoire — on garde l'existante si absente dans l'API
          ...(car.license_plate ? { licensePlate: car.license_plate.toUpperCase() } : {}),
        };

        if (existing) {
          await db.vehicle.update({ where: { id: existing.id }, data: vehicleData });
          result.updated++;
        } else {
          await db.vehicle.create({
            data: {
              ...vehicleData,
              licensePlate: car.license_plate?.toUpperCase() ?? `GA-${car.id}`,
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

const STATE_MAP: Record<string, 'booked' | 'active' | 'completed' | 'cancelled'> = {
  booked: 'booked',
  ongoing: 'active',
  done: 'completed',
  cancelled: 'cancelled',
};

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

  const params = {
    from: (from ?? new Date(Date.now() - 90 * 86_400_000)).toISOString(),
    to: (to ?? new Date(Date.now() + 30 * 86_400_000)).toISOString(),
  };

  const rentals = await ga.getRentals(params);

  for (const r of rentals) {
    try {
      const vehicle = await db.vehicle.findUnique({
        where: { getaroundId: String(r.car_id) },
        select: { id: true },
      });

      if (!vehicle) {
        result.errors.push(`Location ${r.id}: véhicule ${r.car_id} non trouvé`);
        continue;
      }

      const status = STATE_MAP[r.state] ?? 'completed';
      const grossRevenue = r.price_amount / 100;
      const ownerPayout = r.payout_amount ? r.payout_amount / 100 : undefined;

      const rentalData = {
        vehicleId: vehicle.id,
        driverName: r.driver.display_name,
        driverEmail: r.driver.email ?? null,
        driverGetaroundId: String(r.driver.id),
        startAt: new Date(r.starts_at),
        endAt: new Date(r.ends_at),
        grossRevenue,
        ownerPayout,
        status,
      };

      const existing = await db.rental.findUnique({
        where: { getaroundId: String(r.id) },
      });

      if (existing) {
        const prevStatus = existing.status;
        await db.rental.update({ where: { id: existing.id }, data: rentalData });
        result.updated++;
        // Déclenche les séquences sur les transitions de statut
        if (prevStatus === 'booked' && status === 'active') {
          void scheduleSequencesForRental(db, existing.id, 'rental.car_checked_in').catch(console.error);
        } else if (prevStatus === 'active' && status === 'completed') {
          void scheduleSequencesForRental(db, existing.id, 'rental.car_checked_out').catch(console.error);
        }
      } else {
        const created = await db.rental.create({
          data: { ...rentalData, getaroundId: String(r.id) },
        });
        result.created++;
        // Déclenche les séquences pour une nouvelle location réservée
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
