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
  ctResult?: 'favorable' | 'defavorable' | 'contre_visite';
};

// ─── Tâches récurrentes ───────────────────────────────────────────────────────

export async function listTasks(db: PrismaClient) {
  return db.maintenanceTask.findMany({
    include: {
      vehicle: { select: { id: true, make: true, model: true, licensePlate: true, isActive: true, vehicleCategory: true } },
    },
    orderBy: [{ vehicle: { licensePlate: 'asc' } }, { type: 'asc' }],
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
  const task = await db.maintenanceTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { vehicle: { select: { id: true, vehicleCategory: true } } },
  });

  let nextDueDate: Date | null = null;
  let nextDueMileage: number | null = null;
  let ctCounterVisitDeadline: Date | null = null;

  if (task.type === 'ct') {
    if (input.ctResult === 'favorable') {
      const intervalMonths = task.vehicle.vehicleCategory === 'tourisme' ? 24 : 12;
      nextDueDate = addMonths(input.performedAt, intervalMonths);
    } else if (input.ctResult === 'defavorable' || input.ctResult === 'contre_visite') {
      nextDueDate = addMonths(input.performedAt, 2);
      ctCounterVisitDeadline = addMonths(input.performedAt, 2);
    }
    // Pas de nextDueMileage pour le CT
  }

  if (task.type === 'revision') {
    nextDueDate = input.nextDueDate
      ?? (task.intervalMonths ? addMonths(input.performedAt, task.intervalMonths) : null);
    nextDueMileage = input.nextDueMileage
      ?? (task.intervalKm ? input.mileageAtService + task.intervalKm : null);
  }

  // Override manuel explicite (toujours prioritaire sur le calcul auto)
  if (input.nextDueDate) nextDueDate = input.nextDueDate;
  if (input.nextDueMileage) nextDueMileage = input.nextDueMileage;

  // 1. Créer l'entrée historique dans Maintenance
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

  // 2. Mettre à jour la tâche (cumul lifetime + prochain rendez-vous)
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
      ctResult: input.ctResult ?? null,
      ctCounterVisitDeadline: ctCounterVisitDeadline ?? null,
      totalCost: { increment: input.cost },
      occurrenceCount: { increment: 1 },
    },
    include: {
      vehicle: { select: { id: true, make: true, model: true, licensePlate: true, vehicleCategory: true } },
    },
  });
}

// Initialise les tâches CT + révision pour une liste de véhicules,
// et remonte les données depuis l'historique Maintenance existant.
export async function initMaintenanceTasks(
  db: PrismaClient,
  vehicles: Array<{ id: string }>,
): Promise<void> {
  for (const vRef of vehicles) {
    const vehicle = await db.vehicle.findUnique({
      where: { id: vRef.id },
      select: { id: true, vehicleCategory: true },
    });
    if (!vehicle) continue;

    for (const type of ['revision', 'ct'] as const) {
      const intervalMonths = type === 'ct'
        ? (vehicle.vehicleCategory === 'tourisme' ? 24 : 12)
        : 12;
      const intervalKm = type === 'revision' ? 15000 : null;

      // upsert : jamais écraser une tâche existante
      const task = await db.maintenanceTask.upsert({
        where: { vehicleId_type: { vehicleId: vehicle.id, type } },
        update: {},
        create: { vehicleId: vehicle.id, type, intervalMonths, intervalKm },
      });

      // Backfill depuis l'historique Maintenance existant si la tâche est vierge
      if (task.occurrenceCount === 0) {
        const history = await db.maintenance.findMany({
          where: { vehicleId: vehicle.id, type },
          orderBy: { performedAt: 'desc' },
        });
        if (history.length > 0) {
          const latest = history[0];
          const totalCost = history.reduce((s, m) => s + (m.cost ?? 0), 0);
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

// Alertes issues des tâches récurrentes — logique contextuelle selon ctResult
export async function getTaskAlerts(db: PrismaClient, vehicleIds?: string[]) {
  const now = new Date();
  const in30d = new Date(now.getTime() + 30 * 86_400_000);
  const in60d = new Date(now.getTime() + 60 * 86_400_000);

  return db.maintenanceTask.findMany({
    where: {
      vehicle: { isActive: true, ...(vehicleIds ? { id: { in: vehicleIds } } : {}) },
      OR: [
        // Contre-visite CT urgente (deadline dans 30j ou dépassée)
        { type: 'ct', ctResult: { in: ['defavorable', 'contre_visite'] }, ctCounterVisitDeadline: { lte: in30d } },
        // CT favorable à renouveler (dans 60j ou dépassé)
        { type: 'ct', ctResult: 'favorable', nextDueDate: { lte: in60d } },
        // CT sans résultat renseigné mais nextDueDate approche
        { type: 'ct', ctResult: null, nextDueDate: { lte: in60d } },
        // Révision à prévoir (dans 30j ou dépassée)
        { type: 'revision', nextDueDate: { lte: in30d } },
        // Tâches jamais effectuées → à compléter
        { nextDueDate: null, occurrenceCount: 0 },
      ],
    },
    include: {
      vehicle: { select: { id: true, make: true, model: true, licensePlate: true, vehicleCategory: true } },
    },
    orderBy: { nextDueDate: 'asc' },
  });
}

// Migration : lie les Maintenance existants aux tâches et met à jour les cumuls.
// Sûr à ré-exécuter (idempotent via upsert + updateMany with maintenanceTaskId=null).
export async function migrateMaintenanceTasks(db: PrismaClient): Promise<{
  vehicles: number;
  tasksUpdated: number;
}> {
  const vehicles = await db.vehicle.findMany({ select: { id: true } });
  let tasksUpdated = 0;

  for (const vehicle of vehicles) {
    // ── Révision (alias: vidange) ──────────────────────────────────────────────
    const revHistory = await db.maintenance.findMany({
      where: { vehicleId: vehicle.id, type: { in: ['revision', 'vidange'] } },
      orderBy: { performedAt: 'desc' },
    });

    if (revHistory.length > 0) {
      const task = await db.maintenanceTask.findUnique({
        where: { vehicleId_type: { vehicleId: vehicle.id, type: 'revision' } },
        select: { id: true, intervalKm: true, intervalMonths: true },
      });

      if (task) {
        const latest = revHistory[0];
        const totalCost = revHistory.reduce((s, m) => s + (m.cost ?? 0), 0);
        const intervalKm = task.intervalKm ?? 15000;
        const intervalMonths = task.intervalMonths ?? 12;
        const nextDueDate = latest.nextServiceDate ?? addMonths(latest.performedAt, intervalMonths);
        const nextDueMileage = latest.nextServiceMileage ?? (latest.mileageAtService + intervalKm);

        await db.maintenanceTask.update({
          where: { id: task.id },
          data: {
            lastPerformedAt: latest.performedAt,
            lastMileage: latest.mileageAtService,
            lastCost: latest.cost,
            lastProvider: latest.provider,
            lastNotes: latest.notes,
            nextDueDate,
            nextDueMileage,
            totalCost,
            occurrenceCount: revHistory.length,
          },
        });

        await db.maintenance.updateMany({
          where: { vehicleId: vehicle.id, type: { in: ['revision', 'vidange'] }, maintenanceTaskId: null },
          data: { maintenanceTaskId: task.id },
        });

        tasksUpdated++;
      }
    }

    // ── CT ─────────────────────────────────────────────────────────────────────
    const ctHistory = await db.maintenance.findMany({
      where: { vehicleId: vehicle.id, type: 'ct' },
      orderBy: { performedAt: 'desc' },
    });

    if (ctHistory.length > 0) {
      const task = await db.maintenanceTask.findUnique({
        where: { vehicleId_type: { vehicleId: vehicle.id, type: 'ct' } },
        select: { id: true },
      });

      if (task) {
        const latest = ctHistory[0];
        const totalCost = ctHistory.reduce((s, m) => s + (m.cost ?? 0), 0);

        await db.maintenanceTask.update({
          where: { id: task.id },
          data: {
            lastPerformedAt: latest.performedAt,
            lastMileage: latest.mileageAtService,
            lastCost: latest.cost,
            lastProvider: latest.provider,
            lastNotes: latest.notes,
            nextDueDate: latest.nextServiceDate,
            totalCost,
            occurrenceCount: ctHistory.length,
          },
        });

        await db.maintenance.updateMany({
          where: { vehicleId: vehicle.id, type: 'ct', maintenanceTaskId: null },
          data: { maintenanceTaskId: task.id },
        });

        tasksUpdated++;
      }
    }
  }

  console.log(`[migrateMaintenanceTasks] ${vehicles.length} véhicules traités, ${tasksUpdated} tâches mises à jour`);
  return { vehicles: vehicles.length, tasksUpdated };
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
