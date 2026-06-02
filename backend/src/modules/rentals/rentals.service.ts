import type { PrismaClient, RentalStatus, EvaluationStatus } from '../../generated/tenant';

export type RentalFilters = {
  vehicleId?: string;
  vehicleIds?: string[];
  status?: RentalStatus;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
};

export type RentalUpdateInput = {
  startMileage?: number;
  endMileage?: number;
  status?: RentalStatus;
  evaluationStatus?: EvaluationStatus;
  evaluationRating?: number;
  evaluationComment?: string;
  grossRevenue?: number;
  ownerPayout?: number;
  driverMessFee?: number;
  damageCompensation?: number;
  gasRefillFee?: number;
  lateReturnFee?: number;
};

export async function listRentals(db: PrismaClient, filters: RentalFilters = {}) {
  const { vehicleId, vehicleIds, status, from, to, page = 1, limit = 50 } = filters;

  const where = {
    ...(vehicleId ? { vehicleId } : {}),
    ...(vehicleIds ? { vehicleId: { in: vehicleIds } } : {}),
    ...(status ? { status } : {}),
    ...(from || to
      ? {
          startAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const [rentals, total] = await Promise.all([
    db.rental.findMany({
      where,
      include: {
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true, photoUrl: true } },
      },
      orderBy: { startAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.rental.count({ where }),
  ]);

  const rentalsWithEstimate = rentals.map(r => ({
    ...r,
    ownerPayoutEstimated: r.ownerPayout === null && (r.grossRevenue ?? 0) > 0
      ? Math.round((r.grossRevenue ?? 0) / 1.2544 * 100) / 100
      : null,
  }));

  return { rentals: rentalsWithEstimate, total, page, limit };
}

export async function getRental(db: PrismaClient, id: string) {
  return db.rental.findUnique({
    where: { id },
    include: {
      vehicle: {
        select: { id: true, make: true, model: true, licensePlate: true, photoUrl: true, year: true },
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          direction: true,
          content: true,
          sentAt: true,
          status: true,
          aiSuggestion: true,
        },
      },
      incidents: { select: { id: true, type: true, status: true, description: true, cost: true } },
      _count: { select: { messages: true } },
    },
  });
}

export async function updateRental(db: PrismaClient, id: string, data: RentalUpdateInput) {
  const updateData = { ...data } as Record<string, unknown>;

  // Calcul automatique des km parcourus si les deux compteurs sont fournis
  if (data.endMileage !== undefined && data.startMileage !== undefined) {
    updateData.kmDriven = data.endMileage - data.startMileage;
  } else if (data.endMileage !== undefined) {
    const existing = await db.rental.findUnique({ where: { id }, select: { startMileage: true } });
    if (existing?.startMileage) {
      updateData.kmDriven = data.endMileage - existing.startMileage;
    }
  }

  return db.rental.update({ where: { id }, data: updateData });
}

export async function getRentalStats(db: PrismaClient, from: Date, to: Date) {
  const [rentals, vehicleCount] = await Promise.all([
    db.rental.findMany({
      where: {
        startAt: { gte: from },
        endAt: { lte: to },
        status: { in: ['completed', 'active'] },
      },
      select: {
        grossRevenue: true,
        ownerPayout: true,
        kmDriven: true,
        vehicleId: true,
        startAt: true,
        endAt: true,
        status: true,
      },
    }),
    db.vehicle.count({ where: { isActive: true } }),
  ]);

  const totalRevenue = rentals.reduce((s, r) => s + (r.grossRevenue ?? 0), 0);
  const totalPayout = rentals.reduce((s, r) => s + (r.ownerPayout ?? 0), 0);
  const totalKm = rentals.reduce((s, r) => s + (r.kmDriven ?? 0), 0);

  // Taux d'occupation = jours loués / (nb véhicules × nb jours période)
  const periodDays = Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
  const bookedDays = rentals.reduce((s, r) => {
    const start = r.startAt < from ? from : r.startAt;
    const end = r.endAt > to ? to : r.endAt;
    return s + Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
  }, 0);
  const occupancyRate =
    vehicleCount > 0 && periodDays > 0
      ? Math.round((bookedDays / (vehicleCount * periodDays)) * 100)
      : 0;

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalPayout: Math.round(totalPayout * 100) / 100,
    totalKm,
    rentalCount: rentals.length,
    occupancyRate,
    vehicleCount,
  };
}
