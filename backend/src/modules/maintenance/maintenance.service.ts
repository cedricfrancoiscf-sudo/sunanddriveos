import type { PrismaClient } from '../../generated/tenant';

export type MaintenanceInput = {
  vehicleId: string;
  type: string;
  performedAt: Date;
  mileageAtService: number;
  nextServiceDate?: Date;
  nextServiceMileage?: number;
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

// Véhicules dont un entretien est prévu dans les 30 prochains jours ou dépassé
export async function getUpcomingMaintenances(db: PrismaClient) {
  const threshold = new Date(Date.now() + 30 * 86_400_000);
  return db.maintenance.findMany({
    where: {
      OR: [
        { nextServiceDate: { lte: threshold } },
        { nextServiceMileage: { lte: db.vehicle.fields.currentMileage as never } },
      ],
    },
    include: {
      vehicle: { select: { id: true, make: true, model: true, licensePlate: true, currentMileage: true } },
    },
    orderBy: { nextServiceDate: 'asc' },
  });
}
