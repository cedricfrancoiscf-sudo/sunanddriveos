import type { PrismaClient } from '../../generated/tenant';

export type MessageFilters = {
  rentalId?: string;
  vehicleId?: string;
  vehicleIds?: string[];
  rentalStatus?: string;
  startDate?: string;
  endDate?: string;
  direction?: 'inbound' | 'outbound';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
};

export async function listMessages(db: PrismaClient, filters: MessageFilters = {}) {
  const { rentalId, vehicleId, vehicleIds, rentalStatus, startDate, endDate, direction, sortOrder = 'desc', page = 1, limit = 50 } = filters;

  let eligibleRentalIds: string[] | null = null;
  if (vehicleId || vehicleIds || rentalStatus || startDate || endDate) {
    const matchingRentals = await db.rental.findMany({
      where: {
        ...(vehicleId ? { vehicleId } : {}),
        ...(vehicleIds ? { vehicleId: { in: vehicleIds } } : {}),
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

  const [messages, answeredRows, lastInboundRows] = await Promise.all([
    db.message.findMany({
      where: { rentalId: { in: rentalIds } },
      include: {
        rental: {
          select: {
            id: true,
            driverName: true,
            startAt: true,
            endAt: true,
            status: true,
            threadDismissedAt: true,
            vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
          },
        },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
      distinct: ['rentalId'],
    }),
    // Per-rental: has at least one sent/approved outbound?
    db.message.findMany({
      where: { rentalId: { in: rentalIds }, direction: 'outbound', status: { in: ['sent', 'approved'] } },
      select: { rentalId: true },
      distinct: ['rentalId'],
    }),
    // Per-rental: timestamp of the last inbound message
    db.message.findMany({
      where: { rentalId: { in: rentalIds }, direction: 'inbound' },
      select: { rentalId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      distinct: ['rentalId'],
    }),
  ]);

  const answeredSet = new Set(answeredRows.map(m => m.rentalId).filter((id): id is string => id !== null));
  const lastInboundMap = new Map(lastInboundRows.map(m => [m.rentalId, m.createdAt]));

  const messageMap = new Map(messages.map(m => [m.rentalId, m]));
  const ordered = rentalIds.map(rid => messageMap.get(rid)).filter((m): m is NonNullable<typeof m> => m != null);

  // Enrich with computed fields — no schema mutation needed
  const enriched = ordered.map(m => ({
    ...m,
    isThreadAnswered: answeredSet.has(m.rentalId ?? ''),
    lastInboundAt: lastInboundMap.get(m.rentalId ?? '') ?? null,
    threadDismissedAt: m.rental.threadDismissedAt ?? null,
  }));

  const total = await db.message.groupBy({ by: ['rentalId'], where: msgWhere }).then(g => g.length);

  return { messages: enriched, total, page, limit };
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
          status: true,
          threadDismissedAt: true,
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
              importedViaSync: true,
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

export async function dismissThread(db: PrismaClient, rentalId: string) {
  return db.rental.update({
    where: { id: rentalId },
    data: { threadDismissedAt: new Date() },
    select: { id: true, threadDismissedAt: true },
  });
}

export async function undismissThread(db: PrismaClient, rentalId: string) {
  return db.rental.update({
    where: { id: rentalId },
    data: { threadDismissedAt: null },
    select: { id: true, threadDismissedAt: true },
  });
}

export async function getInboxSummary(db: PrismaClient, vehicleIds?: string[]) {
  const settings = await db.companySettings.findFirst({ select: { messageUnansweredMinutes: true } });
  const delayMin = settings?.messageUnansweredMinutes ?? 30;
  const cutoff = new Date(Date.now() - delayMin * 60_000);

  const vFilter = vehicleIds ? { vehicleId: { in: vehicleIds } } : {};

  const [pendingCount, unansweredRentals, unansweredRentalIds] = await Promise.all([
    db.message.count({
      where: {
        status: 'pending_approval',
        ...(vehicleIds ? { rental: vFilter } : {}),
      },
    }),
    db.rental.count({
      where: {
        ...vFilter,
        threadDismissedAt: null,
        messages: {
          some: { direction: 'inbound' },
          none: { direction: 'outbound', status: { in: ['approved', 'sent'] } },
        },
        status: { in: ['booked', 'active'] },
      },
    }),
    db.rental.findMany({
      where: {
        ...vFilter,
        threadDismissedAt: null,
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

  const pendingApprovalMsgs = await db.message.findMany({
    where: {
      direction: 'outbound',
      status: 'pending_approval',
      aiSuggestion: { not: null },
      rental: { status: { in: ['booked', 'active'] }, ...vFilter },
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
