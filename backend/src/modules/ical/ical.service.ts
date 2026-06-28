import type { PrismaClient } from '../../generated/tenant';

// ── Helpers iCal RFC 5545 ──────────────────────────────────────────────────

function icalDate(d: Date): string {
  return d.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
}

function icalEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Fold lines at 75 octets (RFC 5545 §3.1)
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const chunks: string[] = [];
  let offset = 0;
  let first = true;
  while (offset < bytes.length) {
    const limit = first ? 75 : 74; // first line 75, continuation 74 (1 for leading space)
    const chunk = bytes.slice(offset, offset + limit);
    chunks.push((first ? '' : ' ') + chunk.toString('utf8'));
    offset += limit;
    first = false;
  }
  return chunks.join('\r\n');
}

function buildEvent(opts: {
  uid: string;
  summary: string;
  dtstart: Date;
  dtend: Date;
  location: string;
  description: string;
  dtstamp: Date;
}): string {
  const summary = icalEscape(opts.summary);
  const location = icalEscape(opts.location);
  const description = icalEscape(opts.description);

  const lines = [
    'BEGIN:VEVENT',
    `UID:${opts.uid}`,
    `DTSTAMP:${icalDate(opts.dtstamp)}`,
    `DTSTART:${icalDate(opts.dtstart)}`,
    `DTEND:${icalDate(opts.dtend)}`,
    `SUMMARY:${summary}`,
    ...(location ? [`LOCATION:${location}`] : []),
    ...(description ? [`DESCRIPTION:${description}`] : []),
    // Rappel 48h
    'BEGIN:VALARM',
    'TRIGGER:-PT48H',
    'ACTION:DISPLAY',
    `DESCRIPTION:Rappel 48h — ${summary}`,
    'END:VALARM',
    // Rappel 24h
    'BEGIN:VALARM',
    'TRIGGER:-PT24H',
    'ACTION:DISPLAY',
    `DESCRIPTION:Rappel 24h — ${summary}`,
    'END:VALARM',
    'END:VEVENT',
  ];

  return lines.map(foldLine).join('\r\n');
}

function shortId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase();
}

function lastDigits(plate: string): string {
  const digits = plate.replace(/\D/g, '');
  return digits.slice(-3) || plate.slice(-3);
}

// ── Génération iCal ────────────────────────────────────────────────────────

export async function generateAccessoriesIcal(db: PrismaClient): Promise<string> {
  const now = new Date();

  const settings = await db.companySettings.findFirst({ select: { senderName: true } });
  const calName = settings?.senderName ?? 'votre flotte';

  // Demandes de sièges auto confirmées
  const seatRequests = await db.carSeatRequest.findMany({
    where: { status: 'confirmed' },
    include: {
      rental: {
        select: {
          startAt: true, endAt: true, driverName: true,
          vehicle: { select: { make: true, model: true, licensePlate: true, parkingZone: true } },
        },
      },
      carSeat: { select: { name: true } },
    },
  });

  // Réservations d'accessoires confirmées
  const accReservations = await db.accessoryReservation.findMany({
    where: { status: 'confirmed' },
    include: {
      rental: {
        select: {
          startAt: true, endAt: true, driverName: true,
          vehicle: { select: { make: true, model: true, licensePlate: true, parkingZone: true } },
        },
      },
      accessory: { select: { name: true } },
    },
  });

  const events: string[] = [];

  for (const req of seatRequests) {
    if (!req.rental || !req.carSeat) continue;
    const v = req.rental.vehicle;
    const plate3 = lastDigits(v.licensePlate);
    const title = `${v.make} ${v.model} ${plate3} — ${req.carSeat.name} #${shortId(req.id)}`;
    const desc = `Locataire : ${req.rental.driverName}${req.childWeightKg ? ` | Poids enfant : ${req.childWeightKg} kg` : ''}`;
    events.push(buildEvent({
      uid: `csr-${req.id}@sunanddriveos`,
      summary: title,
      dtstart: new Date(req.rental.startAt),
      dtend: new Date(req.rental.endAt),
      location: v.parkingZone ?? '',
      description: desc,
      dtstamp: now,
    }));
  }

  for (const res of accReservations) {
    if (!res.rental || !res.accessory) continue;
    const v = res.rental.vehicle;
    const plate3 = lastDigits(v.licensePlate);
    const title = `${v.make} ${v.model} ${plate3} — ${res.accessory.name} #${shortId(res.id)}`;
    const desc = `Locataire : ${res.rental.driverName}`;
    events.push(buildEvent({
      uid: `acc-${res.id}@sunanddriveos`,
      summary: title,
      dtstart: new Date(res.rental.startAt),
      dtend: new Date(res.rental.endAt),
      location: v.parkingZone ?? '',
      description: desc,
      dtstamp: now,
    }));
  }

  const calLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SunanddriveOS//Accessories//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Accessoires — ${calName}`,
    'X-WR-CALDESC:Réservations accessoires et sièges auto',
    ...events,
    'END:VCALENDAR',
  ];

  return calLines.join('\r\n');
}
