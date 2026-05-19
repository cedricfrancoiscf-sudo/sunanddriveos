import type { PrismaClient } from '../../generated/tenant';

export type MessageFilters = {
  rentalId?: string;
  status?: string;
  direction?: 'inbound' | 'outbound';
  page?: number;
  limit?: number;
};

export async function listMessages(db: PrismaClient, filters: MessageFilters = {}) {
  const { rentalId, status, direction, page = 1, limit = 50 } = filters;

  const where = {
    ...(rentalId ? { rentalId } : {}),
    ...(status ? { status } : {}),
    ...(direction ? { direction } : {}),
  } as never;

  const [messages, total] = await Promise.all([
    db.message.findMany({
      where,
      include: {
        rental: {
          select: {
            id: true,
            driverName: true,
            startAt: true,
            endAt: true,
            vehicle: { select: { id: true, make: true, model: true, licensePlate: true } },
          },
        },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.message.count({ where }),
  ]);

  return { messages, total, page, limit };
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
  const [pendingCount, unansweredRentals] = await Promise.all([
    db.message.count({ where: { status: 'pending_approval' } }),
    // Locations avec message entrant non répondu
    db.rental.count({
      where: {
        messages: {
          some: { direction: 'inbound' },
          none: { direction: 'outbound', status: { in: ['approved', 'sent'] } },
        },
        status: { in: ['booked', 'active'] },
      },
    }),
  ]);

  return { pendingCount, unansweredRentals };
}
