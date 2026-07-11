import type { PrismaClient } from '../../generated/tenant';

// availableStock est un CACHE d'une valeur dérivée, jamais une source de
// vérité en soi : total − hors service − unités actuellement affectées à une
// location en cours (booked/active). Recalculer plutôt qu'incrémenter/
// décrémenter à la main évite qu'un chemin de code oublié (il y en avait
// déjà 4 différents : création manuelle, confirm, AI auto-assign x2) ne
// fasse dériver le stock de façon irréversible.
//
// IMPORTANT : une demande 'confirmed' SANS location (rentalId null) ne tient
// PAS d'unité — elle ne compte que si elle est rattachée à une location
// dont le statut est booked/active. Une demande orpheline ou dont la
// location est completed/cancelled ne doit jamais immobiliser de stock
// indéfiniment (bug du 11/07 : le fallback "sans location => tenue" faisait
// tomber tous les sièges à 0 dès qu'une demande de test/historique traînait).
type CarSeatRequestRow = { id: string; status: string; rentalId: string | null; rental: { status: string } | null };

function isHeld(r: CarSeatRequestRow): boolean {
  return r.status === 'confirmed' && r.rental != null && (r.rental.status === 'booked' || r.rental.status === 'active');
}

export interface CarSeatDiagnostic {
  seatId: string;
  seatName: string;
  totalStock: number;
  outOfService: number;
  heldCount: number;
  availableStock: number;
  // Demandes 'confirmed' périmées (sans location, ou location terminée/
  // annulée) basculées vers 'returned' — neutralisation, aucune suppression.
  neutralized: number;
  requests: Array<{ id: string; status: string; rentalId: string | null; rentalStatus: string | null }>;
}

async function computeCarSeatDiagnostic(db: PrismaClient, carSeatId: string): Promise<CarSeatDiagnostic | null> {
  const seat = await db.carSeat.findUnique({
    where: { id: carSeatId },
    select: { name: true, totalStock: true, outOfService: true },
  });
  if (!seat) return null;

  const requests = await db.carSeatRequest.findMany({
    where: { carSeatId },
    select: { id: true, status: true, rentalId: true, rental: { select: { status: true } } },
  });

  const staleConfirmed = requests.filter(r => r.status === 'confirmed' && !isHeld(r));
  if (staleConfirmed.length > 0) {
    await db.carSeatRequest.updateMany({
      where: { id: { in: staleConfirmed.map(r => r.id) } },
      data: { status: 'returned' },
    });
    for (const r of staleConfirmed) r.status = 'returned';
  }

  const heldCount = requests.filter(isHeld).length;
  const availableStock = Math.max(0, seat.totalStock - seat.outOfService - heldCount);

  return {
    seatId: carSeatId,
    seatName: seat.name,
    totalStock: seat.totalStock,
    outOfService: seat.outOfService,
    heldCount,
    availableStock,
    neutralized: staleConfirmed.length,
    requests: requests.map(r => ({ id: r.id, status: r.status, rentalId: r.rentalId, rentalStatus: r.rental?.status ?? null })),
  };
}

function logDiagnostic(diag: CarSeatDiagnostic): void {
  console.log(`[CarSeatStock] "${diag.seatName}" total=${diag.totalStock} hs=${diag.outOfService} tenues=${diag.heldCount}/${diag.requests.length} neutralisées=${diag.neutralized} -> dispo=${diag.availableStock}`);
  if (diag.requests.length > 0) {
    console.log(`[CarSeatStock]   requêtes: ${diag.requests.map(r => `${r.id.slice(0, 8)}:${r.status}${r.rentalId ? `(location:${r.rentalStatus ?? 'introuvable'})` : '(sans location)'}`).join(', ')}`);
  }
}

export async function recomputeCarSeatStock(db: PrismaClient, carSeatId: string): Promise<number> {
  const diag = await computeCarSeatDiagnostic(db, carSeatId);
  if (!diag) return 0;
  await db.carSeat.update({ where: { id: carSeatId }, data: { availableStock: diag.availableStock } });
  logDiagnostic(diag);
  return diag.availableStock;
}

export async function recomputeAllCarSeatStock(db: PrismaClient): Promise<{ updated: number; details: CarSeatDiagnostic[] }> {
  const seats = await db.carSeat.findMany({ select: { id: true } });
  const details: CarSeatDiagnostic[] = [];
  for (const seat of seats) {
    const diag = await computeCarSeatDiagnostic(db, seat.id);
    if (!diag) continue;
    await db.carSeat.update({ where: { id: seat.id }, data: { availableStock: diag.availableStock } });
    logDiagnostic(diag);
    details.push(diag);
  }
  return { updated: details.length, details };
}
