// Calcul des jours d'indisponibilité d'un véhicule sur une période
// Sources : Blocking (admin) + Unavailability (sync Getaround)

export function computeUnavailableDaysSet(
  blockings: Array<{ startAt: Date | string; endAt: Date | string }>,
  unavailabilities: Array<{ startsAt: Date | string; endsAt: Date | string }>,
  periodStart: Date,
  periodEnd: Date,
): Set<string> {
  const days = new Set<string>();
  const ps = new Date(periodStart); ps.setHours(0, 0, 0, 0);
  const pe = new Date(periodEnd);   pe.setHours(0, 0, 0, 0);

  const addRange = (rawStart: Date | string, rawEnd: Date | string) => {
    let d = new Date(rawStart); d.setHours(0, 0, 0, 0);
    const e = new Date(rawEnd); e.setHours(0, 0, 0, 0);
    if (e < ps || d > pe) return;
    if (d < ps) d = new Date(ps);
    const end = e > pe ? pe : e;
    while (d <= end) {
      days.add(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() + 86_400_000);
    }
  };

  for (const b of blockings)       addRange(b.startAt, b.endAt);
  for (const u of unavailabilities) addRange(u.startsAt, u.endsAt);
  return days;
}
