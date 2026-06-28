import { test, expect } from '@playwright/test';

// Tests for the global-fixes batch: ROI cost filtering, TRI conditional hints,
// multi-tenant settings fields, and sortable tables.

test.describe('45 — Global fixes', () => {
  // ── ROI / Signal / TRI ──────────────────────────────────────────────────────

  test('Revente tab loads and displays ROI data', async ({ page }) => {
    await page.goto('/rentability');
    await page.getByTestId('tab-revente').click();
    await expect(page.getByTestId('revente-tab')).toBeVisible();
  });

  test('Revente tab has sortable columns', async ({ page }) => {
    await page.goto('/rentability');
    await page.getByTestId('tab-revente').click();
    await page.waitForSelector('th:has-text("ROI actuel")');
    const roiTh = page.locator('th', { hasText: /ROI actuel/i }).first();
    await roiTh.click();
    // direction indicator should appear
    await expect(roiTh).toContainText(/↑|↓/);
  });

  test('TRI footnote visible in Revente tab when vehicle has no loanDeposit', async ({ page }) => {
    await page.goto('/rentability');
    await page.getByTestId('tab-revente').click();
    await page.waitForTimeout(1500);
    // footnote is conditional — check the text exists if TRI column shows dashes
    const footnote = page.locator('text=* TRI non calculable');
    const triNull = page.locator('td', { hasText: '—' });
    const hasTriNull = await triNull.count() > 0;
    if (hasTriNull) {
      await expect(footnote).toBeVisible();
    }
  });

  // ── Sortable tables ─────────────────────────────────────────────────────────

  test('VehicleListPage: list view headers are sortable', async ({ page }) => {
    await page.goto('/vehicles');
    const listViewBtn = page.locator('[title="Liste"]').or(page.locator('button[aria-label="Liste"]'));
    if (await listViewBtn.count() > 0) await listViewBtn.click();
    const plTh = page.locator('th', { hasText: /Immatriculation/i }).first();
    if (await plTh.count() > 0) {
      await plTh.click();
      await expect(plTh).toContainText(/↑|↓/);
    }
  });

  test('CTPage: table headers are sortable', async ({ page }) => {
    await page.goto('/technical-control');
    await page.waitForTimeout(1500);
    const prochainTh = page.locator('th', { hasText: /Prochain/i }).first();
    if (await prochainTh.count() > 0) {
      await prochainTh.click();
      await expect(prochainTh).toContainText(/↑|↓/);
    }
  });

  test('UsersPage: table headers are sortable', async ({ page }) => {
    await page.goto('/settings');
    const usersTab = page.locator('button', { hasText: /Membres/i }).or(page.locator('button', { hasText: /Utilisateurs/i }));
    if (await usersTab.count() > 0) await usersTab.click();
    const nomTh = page.locator('th', { hasText: /Membre/i }).first();
    if (await nomTh.count() > 0) {
      await nomTh.click();
      await expect(nomTh).toContainText(/↑|↓/);
    }
  });

  test('ForecastPage: table headers are sortable', async ({ page }) => {
    await page.goto('/intelligence');
    const forecastLink = page.locator('a', { hasText: /Prévisions/i });
    if (await forecastLink.count() > 0) await forecastLink.click();
    else await page.goto('/intelligence/forecasts');
    await page.waitForTimeout(1200);
    const semaineTh = page.locator('th', { hasText: /Semaine/i }).first();
    if (await semaineTh.count() > 0) {
      await semaineTh.click();
      await expect(semaineTh).toContainText(/↑|↓/);
    }
  });

  // ── Settings — new fields ───────────────────────────────────────────────────

  test('SettingsPage: ReventeDecote section has new ROI fields', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForTimeout(1000);
    // look for the new fields
    await expect(page.locator('text=Horizon courbe ROI')).toBeVisible();
    await expect(page.locator('text=Nom de la plateforme')).toBeVisible();
    await expect(page.locator('text=Taux commission plateforme')).toBeVisible();
    await expect(page.locator('text=Profil saisonnier')).toBeVisible();
  });

  test('SettingsPage: seasonal profile toggle shows 12 inputs', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForTimeout(1000);
    const toggle = page.locator('label', { hasText: /Activer/i }).first();
    if (await toggle.count() > 0) {
      await toggle.click();
      const coeffInputs = page.locator('input[min="0.1"][max="3"]');
      await expect(coeffInputs).toHaveCount(12);
    }
  });

  // ── RatingPage sortable ──────────────────────────────────────────────────────

  test('RatingPage: notes historique headers are sortable', async ({ page }) => {
    await page.goto('/intelligence/ratings');
    await page.waitForTimeout(1000);
    const vehicleSelect = page.locator('select').first();
    if (await vehicleSelect.count() > 0) {
      await vehicleSelect.selectOption({ index: 1 });
      await page.waitForTimeout(1000);
      const periodTh = page.locator('th', { hasText: /Période/i }).first();
      if (await periodTh.count() > 0) {
        await periodTh.click();
        await expect(periodTh).toContainText(/↑|↓/);
      }
    }
  });
});
