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

// ─── Statut d'alerte — définition UNIQUE, backend, consommée telle quelle par
// dashboard, /intelligence, le cron matinal ET le frontend (/maintenance, /ct,
// dashboard). Le frontend n'a plus à recalculer d'urgence à partir de dates —
// il affiche task.alertStatus tel que renvoyé par l'API.
export type TaskAlertStatus = 'contre_visite' | 'overdue' | 'urgent' | 'soon' | 'ok' | 'unknown';

const DEFAULT_CT_ALERT_WINDOW_DAYS = 60;

// Défensif : sur ce projet, les migrations Prisma ne sont PAS exécutées
// automatiquement au déploiement (déploiement NAS = copie de fichiers, pas de
// `pnpm migrate`) — un déploiement peut donc arriver avant la migration qui
// ajoute cette colonne. Une requête qui échoue ici (colonne absente) ne doit
// jamais faire tomber tout le dashboard : on retombe sur le défaut, comme un
// null. Cf. incident du 14/07 (/dashboard en 500).
export async function getCtAlertWindowDays(db: PrismaClient): Promise<number> {
  try {
    const settings = await db.companySettings.findFirst({ select: { ctAlertWindowDays: true } });
    return settings?.ctAlertWindowDays ?? DEFAULT_CT_ALERT_WINDOW_DAYS;
  } catch (e) {
    console.error('[Maintenance] ctAlertWindowDays illisible (migration pas encore appliquée ?) — fallback 60j:', e instanceof Error ? e.message : e);
    return DEFAULT_CT_ALERT_WINDOW_DAYS;
  }
}

export function classifyTaskStatus(
  task: {
    type: string;
    nextDueDate: Date | null;
    ctCounterVisitDeadline: Date | null;
    ctResult: string | null;
    occurrenceCount: number;
  },
  ctWindowDays: number,
): TaskAlertStatus {
  if (task.ctCounterVisitDeadline && (task.ctResult === 'defavorable' || task.ctResult === 'contre_visite')) {
    return 'contre_visite';
  }
  if (!task.nextDueDate && task.occurrenceCount === 0) return 'unknown';
  if (!task.nextDueDate) return 'ok';
  const days = Math.ceil((task.nextDueDate.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'overdue';
  if (task.type === 'ct') {
    if (days <= ctWindowDays) return 'urgent';
    if (days <= ctWindowDays * 1.5) return 'soon';
  } else {
    if (days <= 30) return 'soon';
  }
  return 'ok';
}

// ─── Tâches récurrentes ───────────────────────────────────────────────────────

export async function listTasks(db: PrismaClient) {
  const [tasks, ctWindowDays] = await Promise.all([
    db.maintenanceTask.findMany({
      include: {
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true, isActive: true, vehicleCategory: true, deliveryPointName: true, parkingZone: true, currentMileage: true } },
      },
      orderBy: [{ vehicle: { licensePlate: 'asc' } }, { type: 'asc' }],
    }),
    getCtAlertWindowDays(db),
  ]);
  return tasks.map(t => ({ ...t, alertStatus: classifyTaskStatus(t, ctWindowDays) }));
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
      ...(input.ctResult ? { ctResult: input.ctResult } : {}),
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

// Définition UNIQUE de "entretien/CT à prévoir" — importée par intelligence
// (KPIs + chat IA), le dashboard/page maintenance, le cron matinal, le cron
// Telegram J-30 ET le frontend (qui consomme alertStatus, calculé ici, sans
// jamais le recalculer). Ne pas réimplémenter cette logique ailleurs (cf.
// incident du 14/07 : un CT à 33j n'apparaissait sur aucun écran à cause de
// définitions divergentes ; puis 3 recalculs supplémentaires trouvés le
// même jour dans intelligence.routes.ts, server.ts et le frontend).
//
// Fenêtre CT unique, contre-visite et CT normal confondus (configurable via
// CompanySettings.ctAlertWindowDays, défaut 60j) : une contre-visite implique
// un travail à planifier (pièces, budget, immobilisation) donc doit alerter
// PLUS TÔT, pas plus tard — l'ancienne fenêtre 30j-si-contre-visite était à
// l'envers. ctResult n'intervient plus dans le calcul de la fenêtre (il reste
// utile pour l'affichage via classifyTaskStatus), ce qui rend l'alerte
// robuste même quand ctResult n'est pas renseigné.
export async function getTaskAlerts(db: PrismaClient, vehicleIds?: string[]) {
  const [tasks, ctWindowDays] = await Promise.all([
    db.maintenanceTask.findMany({
      where: {
        vehicle: { isActive: true, ...(vehicleIds ? { id: { in: vehicleIds } } : {}) },
      },
      include: {
        vehicle: { select: { id: true, make: true, model: true, licensePlate: true, vehicleCategory: true } },
      },
      orderBy: { nextDueDate: 'asc' },
    }),
    getCtAlertWindowDays(db),
  ]);

  return tasks
    .map(t => ({ ...t, alertStatus: classifyTaskStatus(t, ctWindowDays) }))
    .filter(t => t.alertStatus !== 'ok');
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
            // ctResult n'était pas propagé ici — un CT correctement saisi
            // (ctResult renseigné sur l'entrée Maintenance) pouvait rester
            // invisible au niveau de la tâche après un re-sync/migration.
            ctResult: latest.ctResult,
            ctCounterVisitDeadline:
              latest.ctResult === 'defavorable' || latest.ctResult === 'contre_visite'
                ? latest.nextServiceDate
                : null,
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

// Entretiens PONCTUELS (pneus, freins...) dont l'échéance date (45j) OU km
// (2500km avant) est atteinte. Exclut ct/revision/vidange : ces types sont
// pilotés exclusivement par MaintenanceTask (cf. getTaskAlerts) — CLAUDE.md
// désigne MaintenanceTask comme source unique de vérité pour le CT, et le
// modèle Maintenance (historique) ne doit plus jamais être relu pour décider
// si un CT est à prévoir.
export async function getUpcomingMaintenances(db: PrismaClient) {
  const in45d = new Date(Date.now() + 45 * 86_400_000);

  // Étape 1 : candidats ayant au moins une échéance renseignée
  const candidates = await db.maintenance.findMany({
    where: {
      type: { notIn: ['ct', 'revision', 'vidange'] },
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
