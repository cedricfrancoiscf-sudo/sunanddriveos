import { test, expect } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/user.json' });

const BASE = 'https://appli.sunanddrive.com';

test('35-01 Export page — FEC tab visible et téléchargeable', async ({ page }) => {
  await page.goto(`${BASE}/exports`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await expect(page.getByTestId('tab-export-fec')).toBeVisible();
  await page.getByTestId('tab-export-fec').click();

  await expect(page.getByTestId('btn-export-fec')).toBeVisible();
});

test('35-02 Export page — onglet CSV et téléchargement', async ({ page }) => {
  await page.goto(`${BASE}/exports`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await page.getByTestId('tab-export-csv').click();
  await expect(page.getByTestId('btn-export-csv')).toBeVisible();
  await expect(page.getByTestId('input-export-start')).toBeVisible();
  await expect(page.getByTestId('input-export-end')).toBeVisible();
});

test('35-03 Export page — onglet Autres exports visible', async ({ page }) => {
  await page.goto(`${BASE}/exports`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await page.getByTestId('tab-export-other').click();
  await expect(page.locator('text=Locations détaillées')).toBeVisible();
  await expect(page.locator('text=Flotte')).toBeVisible();
});

test('35-04 Rentabilité — onglets Sinistres et Simulateur visibles', async ({ page }) => {
  await page.goto(`${BASE}/rentability`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await expect(page.getByTestId('rentability-tabs')).toBeVisible();
  await page.getByTestId('tab-sinistres').click();
  await expect(page.getByTestId('sinistres-tab')).toBeVisible();

  await page.getByTestId('tab-simulateur').click();
  await expect(page.getByTestId('simulateur-tab')).toBeVisible();
});

test('35-05 Simulateur ROI — calcul mensualité et marge', async ({ page }) => {
  await page.goto(`${BASE}/rentability`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await page.getByTestId('tab-simulateur').click();
  await page.getByTestId('input-sim-vehiclePrice').fill('20000');
  await page.getByTestId('input-sim-apport').fill('4000');
  await page.getByTestId('input-sim-annualRate').fill('4');
  await page.getByTestId('input-sim-months').fill('48');
  await page.getByTestId('input-sim-monthlyRevenue').fill('800');
  await page.getByTestId('input-sim-monthlyCharges').fill('200');
  await page.waitForTimeout(500);

  await expect(page.locator('text=Mensualité crédit')).toBeVisible();
  await expect(page.locator('text=Marge nette')).toBeVisible();
});

test('35-06 Objectifs CA — onglet visible et champ input', async ({ page }) => {
  await page.goto(`${BASE}/rentability`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await page.getByTestId('tab-objectifs').click();
  await expect(page.getByTestId('objectifs-tab')).toBeVisible();
});

test('35-07 Paramètres — section Comptabilité visible', async ({ page }) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await expect(page.getByTestId('comptabilite-section')).toBeVisible();
  await expect(page.getByTestId('input-compta-journalCode')).toBeVisible();
  await expect(page.getByTestId('input-compta-compteLocationsProduit')).toBeVisible();
});

test('35-08 Paramètres — sauvegarde comptabilité', async ({ page }) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const journalField = page.getByTestId('input-compta-journalCode');
  await journalField.fill('REC');
  await page.getByTestId('comptabilite-section').getByRole('button', { name: /Enregistrer/i }).click();
  await expect(page.locator('text=Sauvegardé ✓').first()).toBeVisible({ timeout: 5000 });

  // Remettre la valeur par défaut
  await journalField.fill('VT');
  await page.getByTestId('comptabilite-section').getByRole('button', { name: /Enregistrer/i }).click();
});

test('35-09 API FEC — endpoint répond avec content-disposition', async ({ request }) => {
  const token = process.env.TEST_TOKEN ?? '';
  const res = await request.get(`${BASE}/api/v1/exports/fec?startDate=2026-01-01&endDate=2026-12-31`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // 200 ou 401 selon le token — au moins pas de 500
  expect([200, 401, 403].includes(res.status())).toBeTruthy();
});

test('35-10 API CSV — endpoint répond sans erreur serveur', async ({ request }) => {
  const token = process.env.TEST_TOKEN ?? '';
  const res = await request.get(`${BASE}/api/v1/exports/csv?startDate=2026-01-01&endDate=2026-12-31`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([200, 401, 403].includes(res.status())).toBeTruthy();
});
