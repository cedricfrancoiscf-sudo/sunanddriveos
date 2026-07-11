import type { PrismaClient } from '../../generated/tenant';

// availableStock est un CACHE d'une valeur dérivée, jamais une source de
// vérité en soi : total − hors service − unités actuellement affectées à une
// location en cours (booked/active). Recalculer plutôt qu'incrémenter/
// décrémenter à la main évite qu'un chemin de code oublié (il y en avait
// déjà 4 différents : création manuelle, confirm, AI auto-assign x2) ne
// fasse dériver le stock de façon irréversible.
export async function recomputeCarSeatStock(db: PrismaClient, carSeatId: string): Promise<number> {
  const seat = await db.carSeat.findUnique({
    where: { id: carSeatId },
    select: { totalStock: true, outOfService: true },
  });
  if (!seat) return 0;

  const held = await db.carSeatRequest.count({
    where: {
      carSeatId,
      status: 'confirmed',
      OR: [
        { rentalId: null },
        { rental: { status: { in: ['booked', 'active'] } } },
      ],
    },
  });

  const availableStock = Math.max(0, seat.totalStock - seat.outOfService - held);
  await db.carSeat.update({ where: { id: carSeatId }, data: { availableStock } });
  return availableStock;
}

export async function recomputeAllCarSeatStock(db: PrismaClient): Promise<{ updated: number }> {
  const seats = await db.carSeat.findMany({ select: { id: true } });
  for (const seat of seats) {
    await recomputeCarSeatStock(db, seat.id);
  }
  return { updated: seats.length };
}
