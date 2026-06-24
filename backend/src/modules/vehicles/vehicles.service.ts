import type { PrismaClient } from '../../generated/tenant';

export type VehicleCreateInput = {
  licensePlate: string;
  make: string;
  model: string;
  year: number;
  color?: string | null;
  photoUrl?: string | null;
  currentMileage?: number;
  thirdPartyOwnerId?: string | null;
  fuelType?: string | null;
  parkingZone?: string | null;
  deliveryPointName?: string | null;
  deliveryPostalCode?: string | null;
  pickupInstructions?: string | null;
  returnInstructions?: string | null;
};

export type VehicleUpdateInput = Partial<VehicleCreateInput> & {
  isActive?: boolean;
  healthScore?: number;
  carekeeperUserId?: string | null;
};

export async function listVehicles(db: PrismaClient, includeInactive = false) {
  return db.vehicle.findMany({
    where: includeInactive ? undefined : { isActive: true },
    include: {
      getaroundAccount: { select: { id: true, name: true } },
      thirdPartyOwner: { select: { id: true, name: true } },
      _count: {
        select: {
          rentals: { where: { status: { in: ['booked', 'active'] } } },
          maintenances: true,
        },
      },
    },
    orderBy: { make: 'asc' },
  });
}

export async function getVehicle(db: PrismaClient, id: string) {
  return db.vehicle.findUnique({
    where: { id },
    include: {
      getaroundAccount: { select: { id: true, name: true } },
      thirdPartyOwner: { select: { id: true, name: true } },
      documents: { orderBy: { createdAt: 'desc' } },
      maintenanceTasks: { where: { type: 'ct' } },
      maintenances: { orderBy: { performedAt: 'desc' }, take: 5 },
      blockings: {
        where: { endAt: { gte: new Date() } },
        orderBy: { startAt: 'asc' },
      },
      accessories: {
        include: { accessory: { select: { id: true, name: true, description: true } } },
      },
    },
  });
}

export async function createVehicle(db: PrismaClient, data: VehicleCreateInput) {
  return db.vehicle.create({ data });
}

export async function updateVehicle(db: PrismaClient, id: string, data: VehicleUpdateInput) {
  return db.vehicle.update({ where: { id }, data });
}

export async function deleteVehicle(db: PrismaClient, id: string) {
  // Soft delete
  return db.vehicle.update({ where: { id }, data: { isActive: false } });
}
