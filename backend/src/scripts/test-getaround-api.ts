// Diagnostic Getaround Owner API v1 — version étendue
// Usage : npx tsx src/scripts/test-getaround-api.ts <API_KEY>

import axios, { type AxiosError, type AxiosResponse } from 'axios';

const BASE_URL = 'https://api-eu.getaround.com/owner/v1';

// IDs fixes pour les tests ciblés (issus du diagnostic précédent)
const KNOWN_RENTAL_ID = 8015113;
const KNOWN_CAR_ID    = 1584539;

// Champs attendus selon les interfaces TypeScript actuelles
const EXPECTED_CAR_FIELDS    = ['id', 'state', 'plate_number', 'brand', 'model', 'address'];
const EXPECTED_RENTAL_FIELDS = ['id', 'car_id', 'user_id', 'starts_at', 'ends_at', 'booked_at', 'price', 'insurance_fee'];
const EXPECTED_USER_FIELDS   = ['id', 'first_name', 'last_name', 'phone_number', 'address_line1', 'postal_code', 'city', 'country', 'birth_date', 'license_country', 'license_first_issue_date', 'license_number'];

// Format ISO8601 UTC — identique à getaround-api.ts en production
function toApiDate(d: Date): string {
  return d.toISOString(); // ex: "2024-01-01T00:00:00.000Z"
}

// ─── helpers ────────────────────────────────────────────────────────────────

function section(title: string) {
  console.log('\n' + '═'.repeat(65));
  console.log(`  ${title}`);
  console.log('═'.repeat(65));
}

function sub(title: string) {
  console.log(`\n  ── ${title}`);
}

function ok(label: string)   { console.log(`  ✅ ${label}`); }
function fail(label: string) { console.log(`  ❌ ${label}`); }
function info(label: string) { console.log(`     ${label}`); }
function warn(label: string) { console.log(`  ⚠️  ${label}`); }

function buildUrl(path: string, params: Record<string, string> = {}): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${BASE_URL}${path}${qs ? '?' + qs : ''}`;
}

function checkFields(
  obj: Record<string, unknown>,
  expected: string[],
): { present: string[]; missing: string[]; extra: string[] } {
  const keys = Object.keys(obj);
  return {
    present: expected.filter((f) => f in obj),
    missing: expected.filter((f) => !(f in obj)),
    extra:   keys.filter((k) => !expected.includes(k)),
  };
}

// Fetch toutes les pages d'un endpoint paginé, retourne les IDs + Link headers
async function fetchAllIds(
  client: ReturnType<typeof axios.create>,
  path: string,
  params: Record<string, string>,
): Promise<{ ids: number[]; pages: number }> {
  const ids: number[] = [];
  let page = 1;
  while (true) {
    const res: AxiosResponse<unknown> = await client.get(path, {
      params: { ...params, page: String(page), per_page: '200' },
    });
    if (res.status !== 200 || !Array.isArray(res.data)) {
      warn(`Page ${page} — status ${res.status}, body : ${JSON.stringify(res.data)}`);
      break;
    }
    for (const item of res.data as { id: number }[]) ids.push(item.id);
    const link = res.headers['link'] as string | undefined;
    if (!link?.includes('rel="next"')) break;
    page++;
  }
  return { ids, pages: page };
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.argv[2];
  if (!apiKey) {
    console.error('Usage : npx tsx src/scripts/test-getaround-api.ts <API_KEY>');
    process.exit(1);
  }

  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
    validateStatus: () => true,
  });

  // Collecte pour le rapport final
  const report = {
    cars: { total: 0, active: 0, deleted: 0, other: 0, pages: 0 },
    rentals2y: { total: 0, pages: 0 },
    carFields:    { present: [] as string[], missing: [] as string[], extra: [] as string[] },
    rentalFields: { present: [] as string[], missing: [] as string[], extra: [] as string[] },
    userFields:   { present: [] as string[], missing: [] as string[], extra: [] as string[] },
    firstCarId: null as number | null,
    firstRentalId: null as number | null,
    firstUserId: null as number | null,
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 1. PAGINATION — /cars.json avec per_page=5
  // ══════════════════════════════════════════════════════════════════════════
  section('1. PAGINATION — GET /cars.json (per_page=5)');
  try {
    const url = buildUrl('/cars.json', { page: '1', per_page: '5' });
    ok(`URL : ${url}`);
    const res1 = await client.get<unknown>('/cars.json', { params: { page: '1', per_page: '5' } });
    ok(`Status HTTP page 1 : ${res1.status}`);
    ok(`Body brut page 1 : ${JSON.stringify(res1.data)}`);

    const link1 = res1.headers['link'] as string | undefined;
    info(`Link header page 1 : ${link1 ?? '(absent)'}`);

    if (res1.status === 200 && Array.isArray(res1.data) && res1.data.length > 0) {
      report.firstCarId = (res1.data[0] as { id: number }).id;
      info(`→ ${res1.data.length} ID(s) en page 1, premier : ${report.firstCarId}`);
      if (link1?.includes('rel="next"')) {
        ok('Pagination détectée — rel="next" présent');
        const res2 = await client.get<unknown>('/cars.json', { params: { page: '2', per_page: '5' } });
        ok(`Status HTTP page 2 : ${res2.status}`);
        ok(`Body brut page 2 : ${JSON.stringify(res2.data)}`);
        info(`Link header page 2 : ${(res2.headers['link'] as string | undefined) ?? '(absent)'}`);
      } else {
        warn('Pas de page suivante (moins de 6 voitures au total, ou pagination non supportée)');
      }
    } else {
      fail(`Réponse inattendue (status ${res1.status})`);
    }
  } catch (err: unknown) {
    fail(`Erreur réseau : ${(err as AxiosError).message}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. VOITURES SUPPRIMÉES — état de chaque voiture sur les 10 premières
  // ══════════════════════════════════════════════════════════════════════════
  section('2. VOITURES SUPPRIMÉES — état (active / deleted / autre)');
  try {
    const res = await client.get<unknown>('/cars.json', { params: { page: '1', per_page: '10' } });
    ok(`Status HTTP : ${res.status}`);
    ok(`Body brut : ${JSON.stringify(res.data)}`);

    if (res.status === 200 && Array.isArray(res.data)) {
      const ids = (res.data as { id: number }[]).map((c) => c.id);
      report.cars.total = ids.length;

      for (const id of ids) {
        const detail = await client.get<Record<string, unknown>>(`/cars/${id}.json`);
        if (detail.status === 200 && typeof detail.data === 'object' && detail.data !== null) {
          const state = String(detail.data.state ?? 'inconnu');
          if (state === 'active')        report.cars.active++;
          else if (state === 'deleted')  report.cars.deleted++;
          else                           report.cars.other++;
          info(`  Car ${id} → state="${state}" plate="${detail.data.plate_number ?? '?'}" brand="${detail.data.brand ?? '?'}"`);

          // Analyse des champs sur la première voiture non-deleted
          if (!report.carFields.present.length && state !== 'deleted') {
            report.carFields = checkFields(detail.data, EXPECTED_CAR_FIELDS);
          }
        } else {
          warn(`Car ${id} — status ${detail.status}`);
        }
      }
      ok(`Résumé : ${report.cars.active} active, ${report.cars.deleted} deleted, ${report.cars.other} autre(s)`);
    } else {
      fail(`Réponse inattendue (status ${res.status})`);
    }
  } catch (err: unknown) {
    fail(`Erreur réseau : ${(err as AxiosError).message}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. LOCATIONS SUR 2 ANS — toutes pages, plage réelle du sync
  // ══════════════════════════════════════════════════════════════════════════
  section('3. LOCATIONS SUR 2 ANS — /rentals.json toutes pages (plage sync)');

  // Fenêtres ≤30 jours sur 2 ans en arrière → 1 an en avance
  const syncStart = new Date(Date.now() - 2 * 365 * 86_400_000);
  const syncEnd   = new Date(Date.now() + 365 * 86_400_000);

  // Découpage en fenêtres de 30 jours (identique au code de production)
  const windows: Array<{ start: Date; end: Date }> = [];
  let cursor = new Date(syncStart);
  while (cursor < syncEnd) {
    const winEnd = new Date(Math.min(cursor.getTime() + 30 * 86_400_000, syncEnd.getTime()));
    windows.push({ start: new Date(cursor), end: winEnd });
    cursor = winEnd;
  }

  info(`Plage : ${toApiDate(syncStart)} → ${toApiDate(syncEnd)}`);
  info(`Nombre de fenêtres 30j : ${windows.length}`);

  const allRentalIds = new Set<number>();
  let totalRentalPages = 0;

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const params = {
      start_date: toApiDate(w.start),
      end_date:   toApiDate(w.end),
    };
    sub(`Fenêtre ${i + 1}/${windows.length} : ${params.start_date} → ${params.end_date}`);
    try {
      const { ids, pages } = await fetchAllIds(client, '/rentals.json', params);
      totalRentalPages += pages;
      for (const id of ids) allRentalIds.add(id);
      info(`  → ${ids.length} ID(s), ${pages} page(s)`);
    } catch (err: unknown) {
      fail(`  Erreur : ${(err as AxiosError).message}`);
    }
  }

  report.rentals2y.total = allRentalIds.size;
  report.rentals2y.pages = totalRentalPages;
  ok(`Total locations uniques : ${allRentalIds.size} (${totalRentalPages} pages au total)`);

  // Prendre la première location disponible pour les tests suivants
  report.firstRentalId = [...allRentalIds][0] ?? KNOWN_RENTAL_ID;
  info(`ID utilisé pour les tests suivants : ${report.firstRentalId}`);

  // ══════════════════════════════════════════════════════════════════════════
  // 4. DÉTAIL LOCATION + CHAMPS
  // ══════════════════════════════════════════════════════════════════════════
  section(`4. DÉTAIL LOCATION — GET /rentals/${report.firstRentalId}.json`);
  try {
    const url = buildUrl(`/rentals/${report.firstRentalId}.json`);
    ok(`URL : ${url}`);
    const res = await client.get<Record<string, unknown>>(`/rentals/${report.firstRentalId}.json`);
    ok(`Status HTTP : ${res.status}`);
    ok(`Body brut :\n${JSON.stringify(res.data, null, 4)}`);

    if (res.status === 200 && typeof res.data === 'object' && res.data !== null) {
      report.rentalFields = checkFields(res.data, EXPECTED_RENTAL_FIELDS);
      report.firstUserId  = (res.data.user_id as number) ?? null;
      if (report.firstUserId) info(`→ user_id : ${report.firstUserId}`);
    } else {
      fail(`Réponse inattendue (status ${res.status})`);
    }
  } catch (err: unknown) {
    fail(`Erreur réseau : ${(err as AxiosError).message}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. MESSAGES — /rentals/{id}/messages.json
  // ══════════════════════════════════════════════════════════════════════════
  section(`5. MESSAGES — GET /rentals/${KNOWN_RENTAL_ID}/messages.json`);
  try {
    const url = buildUrl(`/rentals/${KNOWN_RENTAL_ID}/messages.json`, { page: '1', per_page: '10' });
    ok(`URL : ${url}`);
    const res = await client.get<unknown>(`/rentals/${KNOWN_RENTAL_ID}/messages.json`, {
      params: { page: '1', per_page: '10' },
    });
    ok(`Status HTTP : ${res.status}`);
    ok(`Body brut : ${JSON.stringify(res.data)}`);

    if (res.status === 200 && Array.isArray(res.data)) {
      info(`→ ${res.data.length} message(s) trouvé(s)`);
      const firstMsgId = (res.data[0] as { id: number } | undefined)?.id;
      if (firstMsgId) {
        sub(`Détail message ${firstMsgId}`);
        const msgUrl = buildUrl(`/rentals/${KNOWN_RENTAL_ID}/messages/${firstMsgId}.json`);
        ok(`URL : ${msgUrl}`);
        const msgRes = await client.get<unknown>(`/rentals/${KNOWN_RENTAL_ID}/messages/${firstMsgId}.json`);
        ok(`Status HTTP : ${msgRes.status}`);
        ok(`Body brut :\n${JSON.stringify(msgRes.data, null, 4)}`);
      }
    } else {
      fail(`Réponse inattendue (status ${res.status})`);
    }
  } catch (err: unknown) {
    fail(`Erreur réseau : ${(err as AxiosError).message}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. CHECKIN — /rentals/{id}/checkin.json
  // ══════════════════════════════════════════════════════════════════════════
  section(`6. CHECKIN — GET /rentals/${KNOWN_RENTAL_ID}/checkin.json`);
  try {
    const url = buildUrl(`/rentals/${KNOWN_RENTAL_ID}/checkin.json`);
    ok(`URL : ${url}`);
    const res = await client.get<unknown>(`/rentals/${KNOWN_RENTAL_ID}/checkin.json`);
    ok(`Status HTTP : ${res.status}`);
    ok(`Body brut :\n${JSON.stringify(res.data, null, 4)}`);
  } catch (err: unknown) {
    fail(`Erreur réseau : ${(err as AxiosError).message}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. CHECKOUT — /rentals/{id}/checkout.json
  // ══════════════════════════════════════════════════════════════════════════
  section(`7. CHECKOUT — GET /rentals/${KNOWN_RENTAL_ID}/checkout.json`);
  try {
    const url = buildUrl(`/rentals/${KNOWN_RENTAL_ID}/checkout.json`);
    ok(`URL : ${url}`);
    const res = await client.get<unknown>(`/rentals/${KNOWN_RENTAL_ID}/checkout.json`);
    ok(`Status HTTP : ${res.status}`);
    ok(`Body brut :\n${JSON.stringify(res.data, null, 4)}`);
  } catch (err: unknown) {
    fail(`Erreur réseau : ${(err as AxiosError).message}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. INDISPONIBILITÉS — /cars/{id}/unavailabilities.json sur 30 jours
  // ══════════════════════════════════════════════════════════════════════════
  section(`8. INDISPONIBILITÉS — GET /cars/${KNOWN_CAR_ID}/unavailabilities.json`);
  try {
    const unavStart = toApiDate(new Date());
    const unavEnd   = toApiDate(new Date(Date.now() + 30 * 86_400_000));
    const params    = { start_date: unavStart, end_date: unavEnd, page: '1', per_page: '50' };
    const url = buildUrl(`/cars/${KNOWN_CAR_ID}/unavailabilities.json`, params);
    ok(`URL : ${url}`);
    const res = await client.get<unknown>(`/cars/${KNOWN_CAR_ID}/unavailabilities.json`, { params });
    ok(`Status HTTP : ${res.status}`);
    ok(`Body brut :\n${JSON.stringify(res.data, null, 4)}`);

    if (res.status === 200 && Array.isArray(res.data)) {
      info(`→ ${res.data.length} indisponibilité(s) sur les 30 prochains jours`);
    }
  } catch (err: unknown) {
    fail(`Erreur réseau : ${(err as AxiosError).message}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 9. UTILISATEUR — /users/{id}.json
  // ══════════════════════════════════════════════════════════════════════════
  section(`9. UTILISATEUR — GET /users/${report.firstUserId ?? '<aucun>'}.json`);
  if (report.firstUserId) {
    try {
      const url = buildUrl(`/users/${report.firstUserId}.json`);
      ok(`URL : ${url}`);
      const res = await client.get<Record<string, unknown>>(`/users/${report.firstUserId}.json`);
      ok(`Status HTTP : ${res.status}`);
      ok(`Body brut :\n${JSON.stringify(res.data, null, 4)}`);

      if (res.status === 200 && typeof res.data === 'object' && res.data !== null) {
        report.userFields = checkFields(res.data, EXPECTED_USER_FIELDS);
      } else {
        fail(`Réponse inattendue (status ${res.status})`);
      }
    } catch (err: unknown) {
      fail(`Erreur réseau : ${(err as AxiosError).message}`);
    }
  } else {
    fail('Ignoré — aucun user_id disponible');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RAPPORT FINAL
  // ══════════════════════════════════════════════════════════════════════════
  section('RAPPORT FINAL');

  console.log('\n  ── Voitures (page 1, 10 max)');
  console.log(`     Total récupérés  : ${report.cars.total}`);
  console.log(`     state=active     : ${report.cars.active}`);
  console.log(`     state=deleted    : ${report.cars.deleted}`);
  console.log(`     state=autre      : ${report.cars.other}`);

  console.log('\n  ── Locations (plage sync 2 ans ↔ 1 an)');
  console.log(`     Locations uniques : ${report.rentals2y.total}`);
  console.log(`     Pages totales     : ${report.rentals2y.pages}`);

  const printFields = (label: string, f: { present: string[]; missing: string[]; extra: string[] }) => {
    console.log(`\n  ── Champs ${label} :`);
    if (f.present.length) console.log(`     Présents  : ${f.present.join(', ')}`);
    if (f.missing.length) console.log(`     MANQUANTS : ${f.missing.join(', ')}`);
    if (f.extra.length)   console.log(`     Extra API : ${f.extra.join(', ')}`);
  };

  printFields('/cars/{id}.json',    report.carFields);
  printFields('/rentals/{id}.json', report.rentalFields);
  printFields('/users/{id}.json',   report.userFields);

  const allGood =
    report.carFields.missing.length === 0 &&
    report.rentalFields.missing.length === 0 &&
    report.userFields.missing.length === 0;

  console.log('\n' + '═'.repeat(65));
  if (allGood) {
    console.log('  ✅ Tous les champs attendus sont présents dans les réponses API');
  } else {
    console.log('  ⚠️  Des champs sont manquants — mettre à jour les interfaces TypeScript');
  }
  if (report.cars.deleted > 0) {
    console.log(`  ⚠️  ${report.cars.deleted} voiture(s) deleted — filtre actif dans le sync ✅`);
  }
  console.log('═'.repeat(65) + '\n');
}

main().catch((err: unknown) => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
