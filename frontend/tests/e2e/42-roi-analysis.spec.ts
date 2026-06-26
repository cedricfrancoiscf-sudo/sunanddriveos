import { test, expect } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/user.json' });

test.beforeEach(async ({ page }) => {
  const overlay = page.locator('div.fixed.inset-0[class*="z-[200]"]');
  const visible = await overlay.isVisible({ timeout: 500 }).catch(() => false);
  if (visible) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
});

const BASE = 'https://appli.sunanddrive.com';

async function getFirstVehicleId(page: import('@playwright/test').Page): Promise<string | null> {
  await page.goto(`${BASE}/vehicles`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const link = page.locator('a[href*="/vehicles/"]').first();
  const href = await link.getAttribute('href').catch(() => null);
  if (!href) return null;
  const match = /\/vehicles\/([^/]+)/.exec(href);
  return match?.[1] ?? null;
}

async function gotoVehicle(page: import('@playwright/test').Page, vid: string) {
  await page.goto(`${BASE}/vehicles/${vid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="btn-modifier"]', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape').catch(() => {});
}

test('42-01 Fiche véhicule — section "Analyse de revente" visible', async ({ page }) => {
  const vid = await getFirstVehicleId(page);
  if (!vid) { test.skip(); return; }
  await gotoVehicle(page, vid);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  await expect(page.getByTestId('roi-analysis-section')).toBeVisible({ timeout: 10_000 });
});

test('42-02 Fiche véhicule — message "Saisir la valeur" si marketValue absent', async ({ page }) => {
  const vid = await getFirstVehicleId(page);
  if (!vid) { test.skip(); return; }
  await gotoVehicle(page, vid);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  const section = page.getByTestId('roi-analysis-section');
  await expect(section).toBeVisible({ timeout: 10_000 });
  // Si pas de marketValue → bouton "Saisir la valeur" présent
  const btn = section.getByRole('button', { name: /Saisir la valeur/i });
  const hasCta = await btn.isVisible({ timeout: 3_000 }).catch(() => false);
  // Accepte les deux états : CTA (sans données) ou graphique (avec données)
  const hasChart = await section.locator('svg').first().isVisible({ timeout: 2_000 }).catch(() => false);
  expect(hasCta || hasChart).toBe(true);
});

test('42-03 GET /api/v1/vehicles/:id/roi-analysis répond 200', async ({ page }) => {
  const vid = await getFirstVehicleId(page);
  if (!vid) { test.skip(); return; }
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const tenantId = await page.evaluate(() => localStorage.getItem('tenantId'));
  const resp = await page.request.get(`${BASE.replace('appli', 'api')}/api/v1/vehicles/${vid}/roi-analysis`, {
    headers: {
      Authorization: `Bearer ${token ?? ''}`,
      'X-Tenant-ID': tenantId ?? '',
    },
  });
  expect(resp.status()).toBe(200);
  const body = await resp.json() as { analysis: unknown };
  expect(body).toHaveProperty('analysis');
});

test('42-04 Réponse roi-analysis contient les champs attendus si données présentes', async ({ page }) => {
  const vid = await getFirstVehicleId(page);
  if (!vid) { test.skip(); return; }
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const tenantId = await page.evaluate(() => localStorage.getItem('tenantId'));
  const resp = await page.request.get(`${BASE.replace('appli', 'api')}/api/v1/vehicles/${vid}/roi-analysis`, {
    headers: {
      Authorization: `Bearer ${token ?? ''}`,
      'X-Tenant-ID': tenantId ?? '',
    },
  });
  const body = await resp.json() as { analysis: Record<string, unknown> | null };
  if (!body.analysis) { test.skip(); return; }
  expect(body.analysis).toHaveProperty('roiActuel');
  expect(body.analysis).toHaveProperty('moisOptimal');
  expect(body.analysis).toHaveProperty('signal');
  expect(body.analysis).toHaveProperty('courbe');
  expect(Array.isArray(body.analysis.courbe)).toBe(true);
});

test('42-05 RentabilityPage — onglet "Revente optimale" visible', async ({ page }) => {
  await page.goto(`${BASE}/rentability`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: /Revente optimale/i })).toBeVisible({ timeout: 10_000 });
});

test('42-06 RentabilityPage — contenu onglet Revente optimale', async ({ page }) => {
  await page.goto(`${BASE}/rentability`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Revente optimale/i }).click();
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('revente-tab')).toBeVisible({ timeout: 10_000 });
});

test('42-07 Paramètres — section "Revente & Décote" visible', async ({ page }) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(500);
  await expect(page.getByTestId('revente-decote-section')).toBeVisible({ timeout: 10_000 });
});

test('42-08 Formulaire véhicule — champs financiers présents', async ({ page }) => {
  const vid = await getFirstVehicleId(page);
  if (!vid) { test.skip(); return; }
  await page.goto(`${BASE}/vehicles/${vid}/edit`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await expect(page.getByText('Données financières')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText('Valeur marchande')).toBeVisible({ timeout: 5_000 });
});
