import { getTenantClient } from '../client';

const TENANT_DB_URL = process.env.DATABASE_TENANT_URL ?? process.env.DATABASE_URL ?? '';

const RATINGS: [string, string, number, number, string[], string][] = [
  // EZ480LT
  ['cmpv5pkaa0006r1tdrculwn0w','2026-01',4.82,65,['parking pratique','conforme à l\'annonce','voiture propre','bon rapport qualité-prix'],''],
  ['cmpv5pkaa0006r1tdrculwn0w','2026-02',4.82,67,['conforme à l\'annonce','instructions claires','parking pratique','voiture propre','voiture en bon état'],''],
  ['cmpv5pkaa0006r1tdrculwn0w','2026-03',4.82,71,['bon rapport qualité-prix','parking pratique','propriétaire disponible','voiture propre'],''],
  ['cmpv5pkaa0006r1tdrculwn0w','2026-04',4.82,73,['voiture en bon état','conforme à l\'annonce','parking pratique','bon rapport qualité-prix','instructions claires','propriétaire indisponible'],'Signalement : propriétaire injoignable + siège bébé promis non livré'],
  ['cmpv5pkaa0006r1tdrculwn0w','2026-05',4.82,75,['instructions claires','conforme à l\'annonce','voiture en bon état','parking pratique','voiture propre'],'Signalement : voyants allumés + trappe essence'],
  ['cmpv5pkaa0006r1tdrculwn0w','2026-06',4.82,77,['voiture propre','voiture en bon état','conforme à l\'annonce','parking pratique','instructions claires'],''],

  // FZ375EZ
  ['cmpv5pjdf0002r1td9bsjun8r','2026-01',4.91,57,['voiture propre','instructions claires','conforme à l\'annonce','voiture en bon état','parking pratique'],''],
  ['cmpv5pjdf0002r1td9bsjun8r','2026-02',4.91,59,['bon rapport qualité-prix','instructions claires','conforme à l\'annonce'],''],
  ['cmpv5pjdf0002r1td9bsjun8r','2026-03',4.91,62,['instructions claires','bon rapport qualité-prix','conforme à l\'annonce'],''],
  ['cmpv5pjdf0002r1td9bsjun8r','2026-04',4.91,65,['bon rapport qualité-prix'],''],
  ['cmpv5pjdf0002r1td9bsjun8r','2026-05',4.91,67,['conforme à l\'annonce','bon rapport qualité-prix','parking pratique','propriétaire disponible','voiture en bon état','voiture propre','propriétaire sympa','instructions claires'],''],
  ['cmpv5pjdf0002r1td9bsjun8r','2026-06',4.91,69,['conforme à l\'annonce','voiture en bon état','parking pratique','instructions claires','voiture propre'],''],

  // FZ671YT
  ['cmpv5pjbi0001r1tdxjaox2uh','2026-01',4.71,44,['voiture propre','voiture en bon état','bon rapport qualité-prix','conforme à l\'annonce','propriétaire sympa'],''],
  ['cmpv5pjbi0001r1tdxjaox2uh','2026-02',4.71,46,['bon rapport qualité-prix'],''],
  ['cmpv5pjbi0001r1tdxjaox2uh','2026-03',4.71,49,['conforme à l\'annonce','voiture propre','propriétaire disponible'],''],
  ['cmpv5pjbi0001r1tdxjaox2uh','2026-04',4.71,52,['voiture en bon état','propriétaire disponible','bon rapport qualité-prix','instructions claires','parking pratique','voiture propre','voiture abîmée','parking compliqué'],'Signalement : voiture abîmée + parking compliqué'],
  ['cmpv5pjbi0001r1tdxjaox2uh','2026-05',4.71,54,['voiture en bon état','bon rapport qualité-prix'],''],
  ['cmpv5pjbi0001r1tdxjaox2uh','2026-06',4.71,56,['conforme à l\'annonce','bon rapport qualité-prix','instructions claires','voiture en bon état','voiture propre'],''],

  // EL113HY
  ['cmpv5pkqi0007r1tdbopedjdh','2026-01',4.76,104,['voiture propre','propriétaire disponible','conforme à l\'annonce','voiture en bon état','instructions claires','bon rapport qualité-prix'],''],
  ['cmpv5pkqi0007r1tdbopedjdh','2026-02',4.76,107,['voiture en bon état'],''],
  ['cmpv5pkqi0007r1tdbopedjdh','2026-03',4.76,110,['voiture en bon état','voiture propre','conforme à l\'annonce','parking pratique','bon rapport qualité-prix','instructions claires'],''],
  ['cmpv5pkqi0007r1tdbopedjdh','2026-04',4.76,113,['voiture en bon état','conforme à l\'annonce','parking pratique','propriétaire sympa','voiture propre','voiture sale','parking compliqué'],'Signalement : voiture sale + parking compliqué'],
  ['cmpv5pkqi0007r1tdbopedjdh','2026-05',4.76,115,['voiture en bon état','bon rapport qualité-prix'],''],
  ['cmpv5pkqi0007r1tdbopedjdh','2026-06',4.76,117,['voiture en bon état','conforme à l\'annonce','parking pratique','propriétaire sympa','voiture propre','voiture sale','propriétaire pas sympa'],'Signalement : litige nettoyage 10€'],

  // ET672TZ
  ['cmpv5pk8u0005r1tdxh1wpoc4','2026-01',4.59,54,['propriétaire indisponible','voiture abîmée'],'Signalement : voyant huile + essuie-glaces + freins'],
  ['cmpv5pk8u0005r1tdxh1wpoc4','2026-02',4.59,56,['propriétaire indisponible','voiture abîmée'],'Signalement : voyant huile + essuie-glaces'],
  ['cmpv5pk8u0005r1tdxh1wpoc4','2026-03',4.59,58,['instructions claires','bon rapport qualité-prix','conforme à l\'annonce','voiture propre'],''],
  ['cmpv5pk8u0005r1tdxh1wpoc4','2026-04',4.59,60,['voiture propre','conforme à l\'annonce','bon rapport qualité-prix','parking compliqué'],'Signalement : état des lieux dangereux + sur-facturation 55€ + CarPlay inexistant'],
  ['cmpv5pk8u0005r1tdxh1wpoc4','2026-05',4.59,61,['bon rapport qualité-prix','voiture sale'],'Signalement : voiture sale'],
  ['cmpv5pk8u0005r1tdxh1wpoc4','2026-06',4.59,62,['bon rapport qualité-prix','conforme à l\'annonce'],''],

  // FC275PK
  ['cmpv5pjvj0004r1td5t2dzvhm','2026-01',4.55,52,['conforme à l\'annonce','voiture en bon état','voiture propre','bon rapport qualité-prix','propriétaire disponible'],''],
  ['cmpv5pjvj0004r1td5t2dzvhm','2026-02',4.55,55,['voiture propre','voiture en bon état','conforme à l\'annonce','bon rapport qualité-prix','propriétaire pas sympa','parking compliqué'],'Signalement : propriétaire pas sympa + parking compliqué'],
  ['cmpv5pjvj0004r1td5t2dzvhm','2026-03',4.55,58,['bon rapport qualité-prix','voiture propre','instructions claires','voiture en bon état','conforme à l\'annonce'],''],
  ['cmpv5pjvj0004r1td5t2dzvhm','2026-04',4.55,60,['propriétaire disponible','instructions claires','conforme à l\'annonce','parking compliqué','voiture sale','voiture abîmée'],'Signalement : pneu + parking compliqué + voiture sale'],
  ['cmpv5pjvj0004r1td5t2dzvhm','2026-05',4.55,62,['propriétaire disponible','instructions claires','conforme à l\'annonce'],''],
  ['cmpv5pjvj0004r1td5t2dzvhm','2026-06',4.55,64,['conforme à l\'annonce','voiture propre','propriétaire disponible','parking pratique','voiture en bon état','bon rapport qualité-prix','instructions claires'],''],

  // FY542RR
  ['cmpv5pju30003r1tdwwquicug','2026-01',4.78,57,['voiture propre','propriétaire sympa','conforme à l\'annonce','parking pratique'],''],
  ['cmpv5pju30003r1tdwwquicug','2026-02',4.78,60,['bon rapport qualité-prix','propriétaire disponible','conforme à l\'annonce'],'Signalement : voiture bordeaux ≠ rouge annoncée + accès difficile'],
  ['cmpv5pju30003r1tdwwquicug','2026-03',4.78,63,['conforme à l\'annonce','voiture propre','voiture en bon état','instructions claires'],''],
  ['cmpv5pju30003r1tdwwquicug','2026-04',4.78,65,['bon rapport qualité-prix','conforme à l\'annonce','parking pratique','voiture propre','voiture en bon état'],''],
  ['cmpv5pju30003r1tdwwquicug','2026-05',4.78,67,['conforme à l\'annonce','voiture en bon état','parking pratique','voiture propre','bon rapport qualité-prix','ne correspond pas à l\'annonce','voyant pression pneus'],'Signalement : couleur/km non conformes + voyant pression pneus'],
  ['cmpv5pju30003r1tdwwquicug','2026-06',4.78,69,['bon rapport qualité-prix','conforme à l\'annonce','parking difficile'],''],
];

async function main() {
  if (!TENANT_DB_URL) throw new Error('DATABASE_TENANT_URL ou DATABASE_URL manquant');
  const db = getTenantClient(TENANT_DB_URL);

  let upserted = 0;
  for (const [vehicleId, period, rating, reviewCount, keywords, notes] of RATINGS) {
    await db.vehicleRating.upsert({
      where: { vehicleId_period: { vehicleId, period } },
      update: { rating, reviewCount, keywords, notes: notes || null },
      create: { vehicleId, period, rating, reviewCount, keywords, notes: notes || null },
    });
    upserted++;
  }
  console.log(`[ratings-2026] ${upserted} entrées upsertées (idempotent).`);
  await db.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
