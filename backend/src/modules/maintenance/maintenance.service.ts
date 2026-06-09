import type { PrismaClient } from '../../generated/tenant';

export type MaintenanceInput = {
  vehicleId: string;
  type: string;
  performedAt: Date;
  mileageAtService: number;
  nextServiceDate?: Date;
  nextServiceMileage?: number;
  intervalKm?: number;
  intervalMonths?: number;
  cost?: number;
  provider?: string;
  notes?: string;
  documentUrl?: string;
};

export async function listMaintenances(db: PrismaClient, vehicleId?: string) {
  return db.maintenance.findMany({
    where: vehicleId ? { vehicleId } : undefined,
    include: {
      vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
    },
    orderBy: { performedAt: 'desc' },
  });
}

export async function createMaintenance(db: PrismaClient, data: MaintenanceInput) {
  return db.maintenance.create({ data });
}

export async function updateMaintenance(db: PrismaClient, id: string, data: Partial<MaintenanceInput>) {
  return db.maintenance.update({ where: { id }, data });
}

export async function deleteMaintenance(db: PrismaClient, id: string) {
  return db.maintenance.delete({ where: { id } });
}

// Entretiens dont l'échéance date (45j) OU km (2500km avant) est atteinte
export async function getUpcomingMaintenances(db: PrismaClient) {
  const in45d = new Date(Date.now() + 45 * 86_400_000);

  // Étape 1 : candidats ayant au moins une échéance renseignée
  const candidates = await db.maintenance.findMany({
    where: {
      OR: [
        { nextServiceDate: { not: null, lte: in45d } },
        { nextServiceMileage: { not: null } },
      ],
    },
    include: {
      vehicle: { select: { id: true, make: true, model: true, licensePlate: true, currentMileage: true } },
    },
    orderBy: { nextServiceDate: 'asc' },
  });

  // Étape 2 : filtre JS — date ≤ 45j OU km restants ≤ 2500
  return candidates.filter(m => {
    const dateOk = m.nextServiceDate != null && m.nextServiceDate <= in45d;
    const kmOk =
      m.nextServiceMileage != null &&
      m.vehicle.currentMileage != null &&
      m.nextServiceMileage - m.vehicle.currentMileage <= 2500;
    return dateOk || kmOk;
  });
}
