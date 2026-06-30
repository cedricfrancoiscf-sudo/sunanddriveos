import type { PrismaClient } from '../../generated/tenant';

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^[*\-]\s+/gm, '• ')
    .replace(/__([^_]*)__/g, '$1')
    .replace(/_([^_]*)_/g, '$1')
    .trim();
}

const TRIGGER_EVENTS = ['rental.booked', 'rental.car_checked_in', 'rental.car_checked_out', 'rental.before_checkin', 'rental.before_checkout'] as const;
export type TriggerEvent = typeof TRIGGER_EVENTS[number];

export type SequenceCreateInput = {
  name: string;
  triggerEvent: TriggerEvent;
  delayMinutes: number;
  content: string;
  vehicleId?: string;
};

export async function listSequences(db: PrismaClient) {
  return db.messageSequence.findMany({
    include: {
      _count: { select: { executions: true } },
    },
    orderBy: [{ triggerEvent: 'asc' }, { delayMinutes: 'asc' }],
  });
}

export async function createSequence(db: PrismaClient, data: SequenceCreateInput) {
  return db.messageSequence.create({ data });
}

export async function updateSequence(db: PrismaClient, id: string, data: Partial<SequenceCreateInput> & { isActive?: boolean }) {
  return db.messageSequence.update({ where: { id }, data });
}

export async function deleteSequence(db: PrismaClient, id: string) {
  return db.messageSequence.delete({ where: { id } });
}

export async function toggleSequence(db: PrismaClient, id: string) {
  const seq = await db.messageSequence.findUnique({ where: { id }, select: { isActive: true } });
  if (!seq) throw Object.assign(new Error('Séquence introuvable'), { status: 404 });
  return db.messageSequence.update({ where: { id }, data: { isActive: !seq.isActive } });
}

// Interpolation des variables du template — supporte {{var}} ET {var}
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
    .replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

// Planifie les séquences pour une location donnée
export async function scheduleSequencesForRental(
  db: PrismaClient,
  rentalId: string,
  triggerEvent: TriggerEvent,
) {
  const rental = await db.rental.findUnique({
    where: { id: rentalId },
    include: { vehicle: { select: { id: true, make: true, model: true, licensePlate: true, deliveryPointName: true, pickupInstructions: true, returnInstructions: true } } },
  });
  if (!rental) return;

  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 3_600_000);

  // Ne jamais déclencher sur une location annulée
  if (rental.status === 'cancelled') return;

  // Ne jamais déclencher si la date de fin est dépassée depuis plus de 2h
  if (rental.endAt < twoHoursAgo) return;

  // À la réservation, planifier aussi les séquences "avant événement"
  const triggersToSchedule: TriggerEvent[] =
    triggerEvent === 'rental.booked'
      ? ['rental.booked', 'rental.before_checkin', 'rental.before_checkout']
      : [triggerEvent];

  let totalScheduled = 0;

  for (const t of triggersToSchedule) {
    const sequences = await db.messageSequence.findMany({
      where: {
        triggerEvent: t,
        isActive: true,
        OR: [{ vehicleId: null }, { vehicleId: rental.vehicleId }],
      },
    });

    for (const seq of sequences) {
      let scheduledAt: Date;

      if (t === 'rental.before_checkin') {
        scheduledAt = new Date(rental.startAt.getTime() + seq.delayMinutes * 60_000);
      } else if (t === 'rental.before_checkout') {
        scheduledAt = new Date(rental.endAt.getTime() + seq.delayMinutes * 60_000);
      } else {
        scheduledAt = new Date(Date.now() + seq.delayMinutes * 60_000);
      }

      if (scheduledAt <= now) {
        if (t === 'rental.before_checkin' || t === 'rental.before_checkout') {
          console.log(`[Séquences] Skip ${seq.name} — sendAt ${scheduledAt.toISOString()} déjà passé`);
          continue;
        }
        scheduledAt = now;
      }

      console.log(`[Sequence] scheduledAt calculé : ${scheduledAt.toISOString()} pour rental ${rentalId} (séquence "${seq.name}", délai ${seq.delayMinutes} min)`);
      // Éviter les doublons : si une exécution existe déjà pour ce couple (sequenceId, rentalId) en pending, skip
      const existing = await db.sequenceExecution.findFirst({
        where: { rentalId, sequenceId: seq.id, status: 'pending' },
      });
      if (existing) {
        console.log(`[Sequence] Skip doublon — séquence "${seq.name}" déjà planifiée pour rental ${rentalId}`);
        continue;
      }
      await db.sequenceExecution.create({
        data: { rentalId, sequenceId: seq.id, scheduledAt, status: 'pending' },
      });
      totalScheduled++;
    }
  }

  return totalScheduled;
}

// Exécute les séquences planifiées dont l'heure est venue
export async function executePendingSequences(
  db: PrismaClient,
  sendToGetaround?: (rentalGetaroundId: number, content: string) => Promise<void>,
) {
  const pending = await db.sequenceExecution.findMany({
    where: { status: 'pending', scheduledAt: { lte: new Date() } },
    include: {
      sequence: true,
      rental: {
        include: {
          vehicle: { select: { make: true, model: true, licensePlate: true, deliveryPointName: true, pickupInstructions: true, returnInstructions: true, getaroundAccountId: true } },
        },
      },
    },
    take: 50,
  });

  let executed = 0;
  const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);

  for (const exec of pending) {
    try {
      // Recharger la location pour avoir son statut à jour au moment de l'envoi
      const freshRental = await db.rental.findUnique({
        where: { id: exec.rentalId },
        select: { id: true, status: true, endAt: true },
      });

      if (!freshRental) {
        await db.sequenceExecution.update({
          where: { id: exec.id },
          data: { status: 'cancelled', cancelledReason: 'rental_deleted' },
        });
        continue;
      }

      if (freshRental.status === 'cancelled') {
        await db.sequenceExecution.updateMany({
          where: { rentalId: freshRental.id, status: 'pending' },
          data: { status: 'cancelled', cancelledReason: 'rental_cancelled' },
        });
        continue;
      }

      if (freshRental.status === 'completed' && freshRental.endAt < twoHoursAgo) {
        await db.sequenceExecution.updateMany({
          where: { rentalId: freshRental.id, status: 'pending' },
          data: { status: 'cancelled', cancelledReason: 'rental_completed' },
        });
        continue;
      }

      const fmtDT = (d: Date) => d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const vars: Record<string, string> = {
        driver_name: exec.rental.driverName.split(' ')[0] ?? exec.rental.driverName,
        vehicle: `${exec.rental.vehicle.make} ${exec.rental.vehicle.model}`,
        license_plate: exec.rental.vehicle.licensePlate,
        licensePlate: exec.rental.vehicle.licensePlate,
        start_date: new Date(exec.rental.startAt).toLocaleDateString('fr-FR'),
        end_date: new Date(exec.rental.endAt).toLocaleDateString('fr-FR'),
        startAt: fmtDT(new Date(exec.rental.startAt)),
        endAt: fmtDT(new Date(exec.rental.endAt)),
        deliveryPoint: exec.rental.vehicle.deliveryPointName ?? '',
        pickupInstructions: stripMarkdown(exec.rental.vehicle.pickupInstructions ?? ''),
        returnInstructions: stripMarkdown(exec.rental.vehicle.returnInstructions ?? ''),
      };

      const content = renderTemplate(exec.sequence.content, vars);

      let messageStatus: 'sent' | 'pending_approval' = 'pending_approval';

      const rentalGetaroundId = exec.rental.getaroundId
        ? parseInt(exec.rental.getaroundId, 10)
        : null;

      if (rentalGetaroundId && sendToGetaround) {
        try {
          await sendToGetaround(rentalGetaroundId, content);
          messageStatus = 'sent';
          console.log(`[AutoMessage] ✅ Envoi rental #${rentalGetaroundId} — séquence "${exec.sequence.name}"`);
        } catch (sendErr: unknown) {
          console.error(`[AutoMessage] ❌ Échec envoi rental #${rentalGetaroundId} — séquence "${exec.sequence.name}":`, sendErr instanceof Error ? sendErr.message : sendErr);
        }
      } else if (!rentalGetaroundId) {
        console.warn(`[AutoMessage] ⚠️ Rental ${exec.rentalId} sans getaroundId — message stocké en base uniquement`);
      }

      const message = await db.message.create({
        data: {
          rentalId: exec.rentalId,
          direction: 'outbound',
          content,
          status: messageStatus,
          sentAt: messageStatus === 'sent' ? new Date() : undefined,
        },
      });

      await db.sequenceExecution.update({
        where: { id: exec.id },
        data: { status: 'sent', executedAt: new Date(), messageId: message.id },
      });

      executed++;
    } catch (err: unknown) {
      await db.sequenceExecution.update({
        where: { id: exec.id },
        data: {
          status: 'cancelled',
          errorMessage: err instanceof Error ? err.message : 'Erreur inconnue',
        },
      });
    }
  }

  return { executed, total: pending.length };
}

// Annule les séquences en attente dont la location est terminée ou annulée
export async function cleanupObsoleteSequences(db: PrismaClient): Promise<{ cancelled: number }> {
  const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);

  const result = await db.sequenceExecution.updateMany({
    where: {
      status: 'pending',
      rental: {
        OR: [
          { status: 'cancelled' },
          { status: 'completed', endAt: { lt: twoHoursAgo } },
          { endAt: { lt: twoHoursAgo } },
        ],
      },
    },
    data: { status: 'cancelled', cancelledReason: 'rental_completed' },
  });

  if (result.count > 0) {
    console.log(`[Séquences] ${result.count} séquence(s) obsolète(s) annulée(s)`);
  }
  return { cancelled: result.count };
}
