import { test, expect } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/user.json' });

test.beforeEach(async ({ page }) => {
  await page.keyboard.press('Escape').catch(() => {});
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

test('36-01 Fiche véhicule — section Valeur & Revente visible', async ({ page }) => {
  const vid = await getFirstVehicleId(page);
  if (!vid) { test.skip(); return; }

  await page.goto(`${BASE}/vehicles/${vid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape').catch(() => {});

  await expect(page.getByTestId('valeur-revente-section')).toBeVisible();
});

test('36-02 Fiche véhicule — section Garanties visible avec champs', async ({ page }) => {
  const vid = await getFirstVehicleId(page);
  if (!vid) { test.skip(); return; }

  await page.goto(`${BASE}/vehicles/${vid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape').catch(() => {});

  await expect(page.getByTestId('garanties-section')).toBeVisible();
  await page.getByTestId('garanties-section').getByRole('button', { name: /Modifier/i }).click();
  await expect(page.getByTestId('input-warranty-start')).toBeVisible();
  await expect(page.getByTestId('input-warranty-months')).toBeVisible();
});

test('36-03 Fiche véhicule — sélecteur Crit\'Air visible', async ({ page }) => {
  const vid = await getFirstVehicleId(page);
  if (!vid) { test.skip(); return; }

  await page.goto(`${BASE}/vehicles/${vid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape').catch(() => {});

  await expect(page.getByTestId('critair-section')).toBeVisible();
  await expect(page.getByTestId('select-critair')).toBeVisible();
});

test('36-04 Fiche véhicule — bouton QR Code présent', async ({ page }) => {
  const vid = await getFirstVehicleId(page);
  if (!vid) { test.skip(); return; }

  await page.goto(`${BASE}/vehicles/${vid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape').catch(() => {});

  await expect(page.getByTestId('btn-qr-code')).toBeVisible();
});

test('36-05 Fiche véhicule — QR Code modal s\'ouvre et affiche le canvas', async ({ page }) => {
  const vid = await getFirstVehicleId(page);
  if (!vid) { test.skip(); return; }

  await page.goto(`${BASE}/vehicles/${vid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape').catch(() => {});

  await page.getByTestId('btn-qr-code').click();
  await expect(page.locator('#qr-canvas')).toBeVisible();
  await expect(page.locator('text=Télécharger PNG')).toBeVisible();
});

test('36-06 Intelligence — section Environnement visible', async ({ page }) => {
  await page.goto(`${BASE}/intelligence`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape').catch(() => {});

  await expect(page.getByTestId('environment-section')).toBeVisible();
  await expect(page.locator('text=Bilan carbone')).toBeVisible();
});

test('36-07 Page publique véhicule — accessible sans auth (200)', async ({ page }) => {
  const res = await page.request.get(`${BASE}/public/vehicles/fc275pk`);
  // 200 (trouvé) ou 404 (plaque non trouvée) — jamais 401/403/500
  expect([200, 404].includes(res.status())).toBeTruthy();
});

test('36-08 Page publique véhicule — affiche le contenu sans redirection login', async ({ page }) => {
  // Navigation sans auth state
  await page.context().clearCookies();
  await page.goto(`${BASE}/public/vehicles/fc275pk`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Ne doit PAS rediriger vers /login
  expect(page.url()).not.toContain('/login');
});

test('36-09 Paramètres — section Véhicule visible avec champ Autobiz', async ({ page }) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape').catch(() => {});

  await expect(page.getByTestId('vehicle-settings-section')).toBeVisible();
  await expect(page.getByTestId('input-vehicle-autobizApiKey')).toBeVisible();
  await expect(page.getByTestId('input-vehicle-co2FactorEssence')).toBeVisible();
  await expect(page.getByTestId('input-vehicle-warrantyAlertDays')).toBeVisible();
});

test('36-10 Paramètres — sauvegarde section Véhicule', async ({ page }) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape').catch(() => {});

  const field = page.getByTestId('input-vehicle-warrantyAlertDays');
  await field.fill('45');
  await page.getByTestId('vehicle-settings-section').getByRole('button', { name: /Enregistrer/i }).click();
  await expect(page.locator('text=Sauvegardé ✓').first()).toBeVisible({ timeout: 5000 });

  // Reset
  await field.fill('30');
  await page.getByTestId('vehicle-settings-section').getByRole('button', { name: /Enregistrer/i }).click();
});
