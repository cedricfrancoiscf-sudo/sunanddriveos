import type { PrismaClient } from '../../generated/tenant';

// Messages système Getaround injectés automatiquement dans le fil
// (ex: rappel du point de remise/restitution) — jamais une vraie réponse.
// [\s\S]* plutôt que .* pour couvrir les tournures avec retour à la ligne
// ("Où trouver la/votre voiture", "Où rendre le véhicule"...).
const GETAROUND_SYSTEM_PATTERNS = [
  /où\s+trouver[\s\S]*(voiture|véhicule)/i,
  /où\s+rendre[\s\S]*(voiture|véhicule)/i,
  /where\s+to\s+find[\s\S]*car/i,
  /where\s+to\s+return[\s\S]*car/i,
  /returning\s+the\s+car/i,
  /devolver\s+el\s+coche/i,
  /auto\s+finden/i,
];

export function detectGetaroundSystemMessage(content: string): boolean {
  return GETAROUND_SYSTEM_PATTERNS.some(p => p.test(content));
}

// Templates connus des séquences auto (MessageSequence) — jamais une vraie réponse.
const SEQUENCE_TEMPLATE_PATTERNS = [
  /je vous remercie pour[\s\S]*demande de location/i,
  /nous vous remercions pour votre location/i,
  /bonjour et merci pour votre demande de location/i,
];

export function detectSequenceTemplateMessage(content: string): boolean {
  return SEQUENCE_TEMPLATE_PATTERNS.some(p => p.test(content));
}

// Classifie l'origin d'un message synchronisé/webhook depuis Getaround —
// partagé entre les différents points d'ingestion pour éviter la dérive.
export function classifySyncedMessageOrigin(
  direction: 'inbound' | 'outbound',
  content: string,
): 'inbound' | 'getaround_system' | 'manual' {
  if (direction === 'inbound') return 'inbound';
  return detectGetaroundSystemMessage(content) ? 'getaround_system' : 'manual';
}

// Un outbound compte-t-il comme une vraie réponse (manual/ai_approved) ?
// Liste d'EXCLUSION plutôt que d'inclusion stricte : si origin est manquant
// (ex: back-fill jamais exécuté), on ne bloque jamais tout le fil — on retombe
// sur aiSuggestion/pattern de contenu pour deviner l'origine. Un origin=null
// mal classé au pire compte à tort comme réponse (jamais l'inverse en masse).
export function isRealReplyOrigin(message: { origin: string | null; aiSuggestion: string | null; content: string }): boolean {
  if (message.origin === 'sequence' || message.origin === 'getaround_system') return false;
  if (message.origin === 'manual' || message.origin === 'ai_approved') return true;
  // origin null (inbound n'est jamais passé ici par les appelants)
  if (message.aiSuggestion != null) return true;
  if (detectGetaroundSystemMessage(message.content) || detectSequenceTemplateMessage(message.content)) return false;
  return true;
}

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
    // Per-rental: candidate outbound replies (sequences/system messages never count as an answer)
    // — classification tolérante à origin=null, cf. isRealReplyOrigin
    db.message.findMany({
      where: {
        rentalId: { in: rentalIds },
        direction: 'outbound',
        status: { in: ['sent', 'approved'] },
      },
      select: { rentalId: true, createdAt: true, origin: true, aiSuggestion: true, content: true },
    }),
    // Per-rental: timestamp of the last inbound message
    db.message.findMany({
      where: { rentalId: { in: rentalIds }, direction: 'inbound' },
      select: { rentalId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      distinct: ['rentalId'],
    }),
  ]);

  const lastInboundMap = new Map(lastInboundRows.map(m => [m.rentalId, m.createdAt]));

  // Un fil n'est répondu que si une vraie réponse (manual/ai_approved) suit le dernier inbound
  const answeredSet = new Set<string>();
  for (const row of answeredRows) {
    if (!row.rentalId || answeredSet.has(row.rentalId)) continue;
    if (!isRealReplyOrigin(row)) continue;
    const lastInboundAt = lastInboundMap.get(row.rentalId);
    if (!lastInboundAt || row.createdAt > lastInboundAt) answeredSet.add(row.rentalId);
  }

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
  const message = await db.message.findUnique({
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
              origin: true,
            },
          },
        },
      },
      approvedBy: { select: { id: true, name: true } },
    },
  });
  if (!message) return null;

  // Même définition que listMessages — calculée ici pour que le front n'ait
  // jamais à réimplémenter sa propre copie (source de dérive/régression).
  const thread = message.rental.messages;
  const lastInbound = [...thread].reverse().find(m => m.direction === 'inbound');
  const isThreadAnswered = thread.some(
    m =>
      m.direction === 'outbound' &&
      (m.status === 'sent' || m.status === 'approved') &&
      isRealReplyOrigin(m) &&
      (!lastInbound || m.createdAt > lastInbound.createdAt),
  );

  return { ...message, isThreadAnswered, lastInboundAt: lastInbound?.createdAt ?? null };
}

export async function createOutboundMessage(
  db: PrismaClient,
  rentalId: string,
  content: string,
  aiSuggestion?: string,
  aiAnalysis?: object,
  origin: 'manual' | 'ai_approved' = 'manual',
) {
  return db.message.create({
    data: {
      rentalId,
      direction: 'outbound',
      content,
      aiSuggestion,
      aiAnalysis: aiAnalysis as never,
      status: 'pending_approval',
      origin,
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
