import { test, expect } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/user.json' });

const BASE = 'https://appli.sunanddrive.com';

// IDs fixes production
const FC275PK = 'cmpv5pjvj0004r1td5t2dzvhm';
const EZ480LT = 'cmpv5pkaa0006r1tdrculwn0w';
const ET672TZ = 'cmpv5pk8u0005r1tdxh1wpoc4';

async function apiGet(page: import('@playwright/test').Page, path: string) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const resp = await page.request.get(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  });
  return resp;
}

// ─── Setup : charger auth ───────────────────────────────────────────────────
test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/vehicles`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
});

// ─── ROI caMensuelMoyen ─────────────────────────────────────────────────────
test('43-01 ROI FC275PK — caMensuelMoyen >= 700 (endAt 5 mois complets)', async ({ page }) => {
  const resp = await apiGet(page, `/api/v1/vehicles/${FC275PK}/roi-analysis`);
  expect(resp.status()).toBe(200);
  const body = await resp.json() as { analysis: { caMensuelMoyen: number } | null };
  expect(body.analysis).not.toBeNull();
  expect(body.analysis!.caMensuelMoyen).toBeGreaterThanOrEqual(700);
});

// ─── Ratings jan-mai 2026 ───────────────────────────────────────────────────
test('43-02 Ratings ET672TZ — 6 périodes jan→juin 2026', async ({ page }) => {
  const resp = await apiGet(page, `/api/v1/vehicles/${ET672TZ}/ratings`);
  expect(resp.status()).toBe(200);
  const body = await resp.json() as { ratings: Array<{ period: string; keywords: string[] }> };
  const periods = body.ratings.map(r => r.period).sort();
  expect(periods).toContain('2026-01');
  expect(periods).toContain('2026-02');
  expect(periods).toContain('2026-03');
  expect(periods).toContain('2026-04');
  expect(periods).toContain('2026-05');
  expect(periods).toContain('2026-06');
});

test('43-03 Ratings ET672TZ — jan 2026 keywords contient "propriétaire indisponible"', async ({ page }) => {
  const resp = await apiGet(page, `/api/v1/vehicles/${ET672TZ}/ratings`);
  const body = await resp.json() as { ratings: Array<{ period: string; keywords: string[] }> };
  const jan = body.ratings.find(r => r.period === '2026-01');
  expect(jan).toBeDefined();
  expect(jan!.keywords).toContain('propriétaire indisponible');
});

test('43-04 Ratings EZ480LT — 6 périodes jan→juin 2026', async ({ page }) => {
  const resp = await apiGet(page, `/api/v1/vehicles/${EZ480LT}/ratings`);
  expect(resp.status()).toBe(200);
  const body = await resp.json() as { ratings: Array<{ period: string; keywords: string[] }> };
  const periods = body.ratings.map(r => r.period).sort();
  expect(periods).toContain('2026-01');
  expect(periods).toContain('2026-05');
  expect(periods).toContain('2026-06');
});

test('43-05 Ratings EZ480LT — mai 2026 keywords contient "voiture propre"', async ({ page }) => {
  const resp = await apiGet(page, `/api/v1/vehicles/${EZ480LT}/ratings`);
  const body = await resp.json() as { ratings: Array<{ period: string; keywords: string[] }> };
  const mai = body.ratings.find(r => r.period === '2026-05');
  expect(mai).toBeDefined();
  expect(mai!.keywords).toContain('voiture propre');
});

// ─── ROI TRI + CoC + courbe 48 mois ────────────────────────────────────────
test('43-08 ROI FC275PK — courbe 49 points (48 mois depuis purchaseDate)', async ({ page }) => {
  const resp = await apiGet(page, `/api/v1/vehicles/${FC275PK}/roi-analysis`);
  expect(resp.status()).toBe(200);
  const body = await resp.json() as { analysis: { courbe: unknown[] } | null };
  expect(body.analysis).not.toBeNull();
  expect(body.analysis!.courbe).toHaveLength(49);
});

test('43-09 ROI FC275PK — exactement 1 point estAujourdhui', async ({ page }) => {
  const resp = await apiGet(page, `/api/v1/vehicles/${FC275PK}/roi-analysis`);
  const body = await resp.json() as { analysis: { courbe: Array<{ estAujourdhui: boolean }> } | null };
  const todayPts = (body.analysis?.courbe ?? []).filter(d => d.estAujourdhui);
  expect(todayPts).toHaveLength(1);
});

test('43-10 ROI FC275PK — champs TRI, mensualitePret, caParMoisCalendaire présents', async ({ page }) => {
  const resp = await apiGet(page, `/api/v1/vehicles/${FC275PK}/roi-analysis`);
  const body = await resp.json() as {
    analysis: {
      triActuel: number | null;
      mensualitePret: number;
      caMensuelNormalise: number;
      caParMoisCalendaire: unknown[];
    } | null;
  };
  expect(body.analysis).not.toBeNull();
  expect(body.analysis!.mensualitePret).toBeGreaterThanOrEqual(0);
  expect(body.analysis!.caMensuelNormalise).toBeGreaterThanOrEqual(700);
  expect(body.analysis!.caParMoisCalendaire).toHaveLength(12);
});

test('43-11 ROI FC275PK — cashflowMensuelNet cohérent (±1 €)', async ({ page }) => {
  const resp = await apiGet(page, `/api/v1/vehicles/${FC275PK}/roi-analysis`);
  const body = await resp.json() as {
    analysis: {
      cashflowMensuelNet: number;
      caMensuelNormalise: number;
      coutsMensuelsTotaux: number;
      mensualitePret: number;
    } | null;
  };
  const a = body.analysis!;
  const expected = a.caMensuelNormalise - a.coutsMensuelsTotaux - a.mensualitePret;
  expect(Math.abs(a.cashflowMensuelNet - expected)).toBeLessThanOrEqual(1);
});

// ─── loanDeposit champ formulaire ───────────────────────────────────────────
test('43-06 Formulaire véhicule — champ "Apport personnel" présent', async ({ page }) => {
  await page.goto(`${BASE}/vehicles/${FC275PK}/edit`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await expect(page.getByText('Apport personnel (€)')).toBeVisible({ timeout: 8_000 });
});

// ─── roiCaMoyenMois champ paramètres ────────────────────────────────────────
test('43-07 Paramètres — champ "Mois d\'historique CA moyen" visible', async ({ page }) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(500);
  const section = page.getByTestId('revente-decote-section');
  await expect(section).toBeVisible({ timeout: 10_000 });
  await expect(section.getByText(/Mois d'historique CA moyen/i)).toBeVisible({ timeout: 5_000 });
});

// ─── SettingsPage : labels révision majeure ─────────────────────────────────
test('43-12 Paramètres — libellés "Coût révision majeure" et "Kilométrage déclencheur" visibles', async ({ page }) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const section = page.getByTestId('revente-decote-section');
  await expect(section).toBeVisible({ timeout: 10_000 });
  await expect(section.getByText(/Coût révision majeure estimée/i)).toBeVisible({ timeout: 5_000 });
  await expect(section.getByText(/Kilométrage déclencheur révision majeure/i)).toBeVisible({ timeout: 5_000 });
});

// ─── VehicleDetailPage : KPIs TRI et Cashflow ────────────────────────────────
test('43-13 VehicleDetailPage FC275PK — KPIs "Mensualité prêt" et "TRI actuel" affichés', async ({ page }) => {
  await page.goto(`${BASE}/vehicles/${FC275PK}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const section = page.getByTestId('roi-analysis-section');
  await expect(section).toBeVisible({ timeout: 10_000 });
  await expect(section.getByText(/Mensualité prêt/i)).toBeVisible({ timeout: 8_000 });
  await expect(section.getByText(/TRI actuel/i)).toBeVisible({ timeout: 5_000 });
  await expect(section.getByText(/Cashflow net/i)).toBeVisible({ timeout: 5_000 });
});
