import type { PrismaClient } from '../../generated/tenant';

const TRIGGER_EVENTS = ['rental.booked', 'rental.car_checked_in', 'rental.car_checked_out'] as const;
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

// Interpolation des variables du template
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

// Planifie les séquences pour une location donnée
export async function scheduleSequencesForRental(
  db: PrismaClient,
  rentalId: string,
  triggerEvent: TriggerEvent,
) {
  const rental = await db.rental.findUnique({
    where: { id: rentalId },
    include: { vehicle: { select: { id: true, make: true, model: true } } },
  });
  if (!rental) return;

  const sequences = await db.messageSequence.findMany({
    where: {
      triggerEvent,
      isActive: true,
      OR: [{ vehicleId: null }, { vehicleId: rental.vehicleId }],
    },
  });

  for (const seq of sequences) {
    const scheduledAt = new Date(Date.now() + seq.delayMinutes * 60_000);

    await db.sequenceExecution.create({
      data: {
        rentalId,
        sequenceId: seq.id,
        scheduledAt,
        status: 'pending',
      },
    });
  }

  return sequences.length;
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
          vehicle: { select: { make: true, model: true, licensePlate: true } },
        },
      },
    },
    take: 50,
  });

  let executed = 0;

  for (const exec of pending) {
    try {
      const vars: Record<string, string> = {
        driver_name: exec.rental.driverName,
        vehicle: `${exec.rental.vehicle.make} ${exec.rental.vehicle.model}`,
        license_plate: exec.rental.vehicle.licensePlate,
        start_date: new Date(exec.rental.startAt).toLocaleDateString('fr-FR'),
        end_date: new Date(exec.rental.endAt).toLocaleDateString('fr-FR'),
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
        } catch (sendErr: unknown) {
          console.error('[Séquences] Échec envoi Getaround rental', rentalGetaroundId, sendErr);
        }
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
