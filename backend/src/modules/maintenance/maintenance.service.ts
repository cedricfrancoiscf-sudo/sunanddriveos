import { addMonths } from 'date-fns';
import type { PrismaClient } from '../../generated/tenant';

export type TaskUpdateInput = {
  performedAt: Date;
  mileageAtService: number;
  cost: number;
  provider?: string;
  notes?: string;
  nextDueDate?: Date;
  nextDueMileage?: number;
};

// ─── Tâches récurrentes ───────────────────────────────────────────────────────

export async function listTasks(db: PrismaClient) {
  return db.maintenanceTask.findMany({
    include: {
      vehicle: { select: { id: true, make: true, model: true, licensePlate: true, isActive: true } },
    },
    orderBy: [{ nextDueDate: 'asc' }, { vehicleId: 'asc' }],
  });
}

export async function getTasksByVehicle(db: PrismaClient, vehicleId: string) {
  return db.maintenanceTask.findMany({
    where: { vehicleId },
    orderBy: { type: 'asc' },
  });
}

export async function getTaskHistory(db: PrismaClient, vehicleId: string, type?: string) {
  return db.maintenance.findMany({
    where: {
      vehicleId,
      ...(type ? { type } : {}),
      maintenanceTaskId: { not: null },
    },
    orderBy: { performedAt: 'desc' },
  });
}

export async function updateTask(db: PrismaClient, taskId: string, input: TaskUpdateInput) {
  const task = await db.maintenanceTask.findUniqueOrThrow({ where: { id: taskId } });

  // Calcul automatique de la prochaine échéance si non fournie
  const nextDueDate = input.nextDueDate
    ?? (task.intervalMonths ? addMonths(input.performedAt, task.intervalMonths) : null);
  const nextDueMileage = input.nextDueMileage
    ?? (task.intervalKm ? input.mileageAtService + task.intervalKm : null);

  // 1. Créer l'entrée historique
  await db.maintenance.create({
    data: {
      vehicleId: task.vehicleId,
      maintenanceTaskId: task.id,
      type: task.type,
      performedAt: input.performedAt,
      mileageAtService: input.mileageAtService,
      cost: input.cost,
      provider: input.provider,
      notes: input.notes,
      ...(nextDueDate ? { nextServiceDate: nextDueDate } : {}),
      ...(nextDueMileage ? { nextServiceMileage: nextDueMileage } : {}),
    },
  });

  // 2. Mettre à jour la tâche (cumul coûts + prochain rendez-vous)
  return db.maintenanceTask.update({
    where: { id: taskId },
    data: {
      lastPerformedAt: input.performedAt,
      lastMileage: input.mileageAtService,
      lastCost: input.cost,
      lastProvider: input.provider ?? null,
      lastNotes: input.notes ?? null,
      nextDueDate: nextDueDate ?? null,
      nextDueMileage: nextDueMileage ?? null,
      totalCost: { increment: input.cost },
      occurrenceCount: { increment: 1 },
    },
    include: {
      vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
    },
  });
}

// Initialise les tâches CT + révision pour une liste de véhicules,
// et remonte les données depuis l'historique Maintenance existant.
export async function initMaintenanceTasks(
  db: PrismaClient,
  vehicles: Array<{ id: string }>,
): Promise<void> {
  for (const vehicle of vehicles) {
    for (const type of ['revision', 'ct'] as const) {
      // upsert : ne rien écraser si déjà existant
      const task = await db.maintenanceTask.upsert({
        where: { vehicleId_type: { vehicleId: vehicle.id, type } },
        update: {},
        create: {
          vehicleId: vehicle.id,
          type,
          intervalMonths: type === 'ct' ? 24 : 12,
          intervalKm: type === 'revision' ? 15000 : null,
        },
      });

      // Backfill depuis l'historique Maintenance existant si la tâche est vide
      if (task.occurrenceCount === 0) {
        const history = await db.maintenance.findMany({
          where: { vehicleId: vehicle.id, type },
          orderBy: { performedAt: 'desc' },
        });
        if (history.length > 0) {
          const latest = history[0];
          const totalCost = history.reduce((s, m) => s + (m.cost ?? 0), 0);
          // Lier tous les historiques à la tâche
          await db.maintenance.updateMany({
            where: { vehicleId: vehicle.id, type, maintenanceTaskId: null },
            data: { maintenanceTaskId: task.id },
          });
          await db.maintenanceTask.update({
            where: { id: task.id },
            data: {
              lastPerformedAt: latest.performedAt,
              lastMileage: latest.mileageAtService,
              lastCost: latest.cost,
              lastProvider: latest.provider,
              lastNotes: latest.notes,
              nextDueDate: latest.nextServiceDate,
              nextDueMileage: latest.nextServiceMileage,
              totalCost,
              occurrenceCount: history.length,
            },
          });
        }
      }
    }
  }
}

// Alertes issues des tâches récurrentes (CT dans 60j, révision dans 30j)
export async function getTaskAlerts(db: PrismaClient) {
  const now = new Date();
  const in30d = new Date(now.getTime() + 30 * 86_400_000);
  const in60d = new Date(now.getTime() + 60 * 86_400_000);

  return db.maintenanceTask.findMany({
    where: {
      vehicle: { isActive: true },
      OR: [
        { type: 'revision', nextDueDate: { lte: in30d } },
        { type: 'ct', nextDueDate: { lte: in60d } },
        // Tâches sans date connue et jamais effectuées → toujours en alerte
        { nextDueDate: null, occurrenceCount: 0 },
      ],
    },
    include: {
      vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
    },
    orderBy: { nextDueDate: 'asc' },
  });
}

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
