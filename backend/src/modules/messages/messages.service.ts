import type { PrismaClient } from '../../generated/tenant';

export type MessageFilters = {
  rentalId?: string;
  vehicleId?: string;
  rentalStatus?: string;
  startDate?: string;
  endDate?: string;
  direction?: 'inbound' | 'outbound';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
};

export async function listMessages(db: PrismaClient, filters: MessageFilters = {}) {
  const { rentalId, vehicleId, rentalStatus, startDate, endDate, direction, sortOrder = 'desc', page = 1, limit = 50 } = filters;

  // Étape 1 : si filtres sur la location, résoudre les rentalIds éligibles
  let eligibleRentalIds: string[] | null = null;
  if (vehicleId || rentalStatus || startDate || endDate) {
    const matchingRentals = await db.rental.findMany({
      where: {
        ...(vehicleId ? { vehicleId } : {}),
        ...(rentalStatus ? { status: rentalStatus as never } : {}),
        ...(startDate ? { startAt: { gte: new Date(startDate) } } : {}),
        ...(endDate ? { endAt: { lte: new Date(endDate) } } : {}),
      },
      select: { id: true },
    });
    eligibleRentalIds = matchingRentals.map(r => r.id);
    if (eligibleRentalIds.length === 0) return { messages: [], total: 0, page, limit };
  }

  const msgWhere = {
    ...(rentalId ? { rentalId } : {}),
    ...(direction ? { direction } : {}),
    ...(eligibleRentalIds ? { rentalId: { in: eligibleRentalIds } } : {}),
  } as never;

  // Étape 2 : groupBy rentalId → conversations distinctes triées par dernier message
  const rentalGroups = await db.message.groupBy({
    by: ['rentalId'],
    _max: { sentAt: true },
    where: msgWhere,
    orderBy: { _max: { sentAt: sortOrder } },
    skip: (page - 1) * limit,
    take: limit,
  });

  const rentalIds = rentalGroups.map(g => g.rentalId).filter((id): id is string => id !== null);

  if (rentalIds.length === 0) {
    const total = await db.message.groupBy({ by: ['rentalId'], where: msgWhere }).then(g => g.length);
    return { messages: [], total, page, limit };
  }

  // Étape 3 : message le plus récent par conversation (distinct rentalId)
  const messages = await db.message.findMany({
    where: { rentalId: { in: rentalIds } },
    include: {
      rental: {
        select: {
          id: true,
          driverName: true,
          startAt: true,
          endAt: true,
          status: true,
          vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
        },
      },
      approvedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
    distinct: ['rentalId'],
  });

  // Étape 4 : réordonner selon l'ordre des groupes
  const messageMap = new Map(messages.map(m => [m.rentalId, m]));
  const ordered = rentalIds.map(rid => messageMap.get(rid)).filter((m): m is NonNullable<typeof m> => m != null);

  const total = await db.message.groupBy({ by: ['rentalId'], where: msgWhere }).then(g => g.length);

  return { messages: ordered, total, page, limit };
}

export async function getMessage(db: PrismaClient, id: string) {
  return db.message.findUnique({
    where: { id },
    include: {
      rental: {
        select: {
          id: true,
          driverName: true,
          driverEmail: true,
          startAt: true,
          endAt: true,
          vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
          messages: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              direction: true,
              content: true,
              sentAt: true,
              status: true,
              aiSuggestion: true,
              aiAnalysis: true,
              createdAt: true,
            },
          },
        },
      },
      approvedBy: { select: { id: true, name: true } },
    },
  });
}

export async function createOutboundMessage(
  db: PrismaClient,
  rentalId: string,
  content: string,
  aiSuggestion?: string,
  aiAnalysis?: object,
) {
  return db.message.create({
    data: {
      rentalId,
      direction: 'outbound',
      content,
      aiSuggestion,
      aiAnalysis: aiAnalysis as never,
      status: 'pending_approval',
    },
  });
}

export async function approveMessage(db: PrismaClient, id: string, approverId: string, content?: string) {
  const data: Record<string, unknown> = {
    status: 'approved',
    approvedById: approverId,
    approvedAt: new Date(),
  };
  // Permet de modifier le contenu avant approbation
  if (content) data.content = content;

  return db.message.update({ where: { id }, data });
}

export async function markAsSent(db: PrismaClient, id: string, getaroundMessageId?: string) {
  return db.message.update({
    where: { id },
    data: {
      status: 'sent',
      sentAt: new Date(),
      ...(getaroundMessageId ? { getaroundId: getaroundMessageId } : {}),
    },
  });
}

export async function cancelMessage(db: PrismaClient, id: string) {
  return db.message.update({
    where: { id },
    data: { status: 'cancelled', cancelledAt: new Date() },
  });
}

export async function getInboxSummary(db: PrismaClient) {
  const settings = await db.companySettings.findFirst({ select: { messageUnansweredMinutes: true } });
  const delayMin = settings?.messageUnansweredMinutes ?? 30;
  const cutoff = new Date(Date.now() - delayMin * 60_000);

  const [pendingCount, unansweredRentals, unansweredRentalIds] = await Promise.all([
    db.message.count({ where: { status: 'pending_approval' } }),
    db.rental.count({
      where: {
        messages: {
          some: { direction: 'inbound' },
          none: { direction: 'outbound', status: { in: ['approved', 'sent'] } },
        },
        status: { in: ['booked', 'active'] },
      },
    }),
    // Locations actives/à venir avec inbound > 2h et aucune réponse outbound
    db.rental.findMany({
      where: {
        status: { in: ['booked', 'active'] },
        messages: {
          some: { direction: 'inbound', createdAt: { lt: cutoff } },
          none: { direction: 'outbound', status: { in: ['approved', 'sent'] } },
        },
      },
      select: { id: true },
    }).then(rows => rows.map(r => r.id)),
  ]);

  const unansweredMessages = unansweredRentalIds.length > 0
    ? await db.message.findMany({
        where: { direction: 'inbound', createdAt: { lt: cutoff }, rentalId: { in: unansweredRentalIds } },
        select: {
          id: true, content: true, createdAt: true,
          rental: {
            select: {
              id: true, driverName: true,
              vehicle: { select: { make: true, model: true, licensePlate: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: 5,
        distinct: ['rentalId'],
      })
    : [];

  const unansweredDetails = unansweredMessages.map(m => ({
    rentalId: m.rental?.id ?? '',
    driverName: m.rental?.driverName ?? '',
    vehicleLabel: m.rental
      ? `${m.rental.vehicle.make} ${m.rental.vehicle.model} (${m.rental.vehicle.licensePlate})`
      : '',
    msgPreview: m.content.slice(0, 80),
    createdAt: m.createdAt.toISOString(),
  }));

  // Brouillons IA en attente de validation (outbound pending_approval avec aiSuggestion)
  const pendingApprovalMsgs = await db.message.findMany({
    where: {
      direction: 'outbound',
      status: 'pending_approval',
      aiSuggestion: { not: null },
      rental: { status: { in: ['booked', 'active'] } },
    },
    select: {
      id: true,
      rental: {
        select: {
          id: true, driverName: true,
          vehicle: { select: { make: true, model: true, licensePlate: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    distinct: ['rentalId'],
  });

  const pendingApprovalDetails = pendingApprovalMsgs.map(m => ({
    messageId: m.id,
    rentalId: m.rental?.id ?? '',
    driverName: m.rental?.driverName ?? '',
    vehicleLabel: m.rental
      ? `${m.rental.vehicle.make} ${m.rental.vehicle.model} (${m.rental.vehicle.licensePlate})`
      : '',
  }));

  return {
    pendingCount, unansweredRentals,
    unansweredMessages: unansweredDetails,
    pendingApprovalMessages: pendingApprovalDetails,
    unansweredDelayMs: delayMin * 60_000,
  };
}
