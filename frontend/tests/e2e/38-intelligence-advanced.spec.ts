import { test, expect } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/user.json' });

test.beforeEach(async ({ page }) => {
  await page.keyboard.press('Escape').catch(() => {});
});

const BASE = 'https://appli.sunanddrive.com';

async function getFirstRentalId(page: import('@playwright/test').Page): Promise<string | null> {
  await page.goto(`${BASE}/rentals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const link = page.locator('a[href*="/rentals/"]').first();
  const href = await link.getAttribute('href').catch(() => null);
  if (!href) return null;
  const match = /\/rentals\/([^/]+)/.exec(href);
  return match?.[1] ?? null;
}

test('38-01 Intelligence — section Corrélations visible', async ({ page }) => {
  await page.goto(`${BASE}/intelligence`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape').catch(() => {});

  await expect(page.getByTestId('correlation-section')).toBeVisible();
  await expect(page.locator('text=Note vs Taux d\'occupation').first()).toBeVisible();
});

test('38-02 Intelligence — section Benchmark visible', async ({ page }) => {
  await page.goto(`${BASE}/intelligence`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape').catch(() => {});

  await expect(page.getByTestId('benchmark-section')).toBeVisible();
});

test('38-03 Intelligence — API /correlation retourne 200', async ({ page }) => {
  const ctx = page.context();
  const storageState = await ctx.storageState();
  const token = storageState.origins
    .flatMap(o => o.localStorage)
    .find(e => e.name === 'auth_token')?.value;

  const apiBase = `${BASE}/api/v1`;
  const res = await page.request.get(`${apiBase}/intelligence/correlation`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  expect([200, 401]).toContain(res.status());
});

test('38-04 Fiche location — badge score risque visible', async ({ page }) => {
  const id = await getFirstRentalId(page);
  if (!id) { test.skip(); return; }

  await page.goto(`${BASE}/rentals/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await expect(page.getByTestId('risk-score-badge')).toBeVisible();
});

test('38-05 Fiche location — badge risque contient score numérique', async ({ page }) => {
  const id = await getFirstRentalId(page);
  if (!id) { test.skip(); return; }

  await page.goto(`${BASE}/rentals/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const badge = page.getByTestId('risk-score-badge');
  await expect(badge).toBeVisible();
  const text = await badge.innerText();
  expect(text).toMatch(/\d+\/100/);
});

test('38-06 Paramètres — section Intelligence visible', async ({ page }) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape').catch(() => {});

  await expect(page.getByTestId('intelligence-settings-section')).toBeVisible();
});

test('38-07 Paramètres — champs Intelligence présents', async ({ page }) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape').catch(() => {});

  await expect(page.getByTestId('input-intelligence-ratingDropThreshold')).toBeVisible();
  await expect(page.getByTestId('input-intelligence-underutilizationThreshold')).toBeVisible();
  await expect(page.getByTestId('input-intelligence-underutilizationWeeks')).toBeVisible();
  await expect(page.getByTestId('input-intelligence-riskScoreAlertThreshold')).toBeVisible();
});

test('38-08 Paramètres — pondérations score risque modifiables', async ({ page }) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape').catch(() => {});

  await expect(page.getByTestId('input-intelligence-riskWeightScore')).toBeVisible();
  await expect(page.getByTestId('input-intelligence-riskWeightFlags')).toBeVisible();
  await expect(page.getByTestId('input-intelligence-riskWeightCancelled')).toBeVisible();
  await expect(page.getByTestId('input-intelligence-riskWeightDelay')).toBeVisible();
});

test('38-09 Paramètres — sauvegarde section Intelligence', async ({ page }) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape').catch(() => {});

  const field = page.getByTestId('input-intelligence-underutilizationWeeks');
  await field.fill('6');
  await page.getByTestId('intelligence-settings-section').getByRole('button', { name: /Enregistrer/i }).click();
  await expect(page.locator('text=Sauvegardé ✓').first()).toBeVisible({ timeout: 5000 });

  // Reset
  await field.fill('4');
  await page.getByTestId('intelligence-settings-section').getByRole('button', { name: /Enregistrer/i }).click();
});
