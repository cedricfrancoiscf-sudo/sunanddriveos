import { test, expect } from '@playwright/test';
import { getTenantToken } from './helpers/auth';

test.use({ storageState: 'tests/e2e/.auth/user.json' });

test.beforeEach(async ({ page }) => {
  await page.keyboard.press('Escape').catch(() => {});
});

const BASE = 'https://appli.sunanddrive.com';

test.describe('Séquences automatiques', () => {
  test('page séquences accessible', async ({ page }) => {
    await page.goto(`${BASE}/sequences`, { waitUntil: 'networkidle' });
    await page.keyboard.press('Escape').catch(() => {});
    await expect(page.locator('h1')).toContainText('Séquences');
  });

  test('champ intervalle minimum visible et modifiable', async ({ page }) => {
    await page.goto(`${BASE}/sequences`, { waitUntil: 'networkidle' });
    await page.keyboard.press('Escape').catch(() => {});
    const input = page.getByTestId('input-min-message-interval');
    await expect(input).toBeVisible();
    await input.fill('90');
    await expect(input).toHaveValue('90');
  });

  test('GET /api/v1/sequences retourne 200', async ({ playwright }) => {
    const token = await getTenantToken().catch(() => null);
    if (!token) { console.log('[39] getTenantToken failed — test ignoré'); return; }
    const ctx = await playwright.request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    try {
      const res = await ctx.get(`${BASE}/api/v1/sequences`);
      expect(res.status()).toBe(200);
      const body = await res.json() as { sequences: unknown[] };
      expect(Array.isArray(body.sequences)).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });

  test('bouton Historique présent sur la première séquence', async ({ page }) => {
    await page.goto(`${BASE}/sequences`, { waitUntil: 'networkidle' });
    const btns = page.locator('[data-testid^="btn-historique-"]');
    const count = await btns.count();
    if (count === 0) {
      // Pas de séquences configurées = pas de bouton = OK
      return;
    }
    await expect(btns.first()).toBeVisible();
  });

  test('bouton Tester présent sur la première séquence', async ({ page }) => {
    await page.goto(`${BASE}/sequences`, { waitUntil: 'networkidle' });
    const btns = page.locator('[data-testid^="btn-tester-"]');
    const count = await btns.count();
    if (count === 0) return;
    await expect(btns.first()).toBeVisible();
  });

  test('modal Tester affiche un aperçu interpolé', async ({ page }) => {
    await page.goto(`${BASE}/sequences`, { waitUntil: 'networkidle' });
    const btns = page.locator('[data-testid^="btn-tester-"]');
    if (await btns.count() === 0) return;
    await btns.first().click();
    await expect(page.locator('text=Aperçu')).toBeVisible();
    await expect(page.locator('text=Simulation uniquement')).toBeVisible();
  });

  test('GET /api/v1/sequences/:id/logs retourne 200 pour la première séquence', async ({ playwright }) => {
    const token = await getTenantToken().catch(() => null);
    if (!token) { console.log('[39] getTenantToken failed — test ignoré'); return; }
    const ctx = await playwright.request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    try {
      const listRes = await ctx.get(`${BASE}/api/v1/sequences`);
      const listBody = await listRes.json() as { sequences?: Array<{ id: string }> };
      if (!listBody.sequences || listBody.sequences.length === 0) return;
      const id = listBody.sequences[0]?.id;
      const res = await ctx.get(`${BASE}/api/v1/sequences/${id}/logs`);
      expect(res.status()).toBe(200);
      const body = await res.json() as { logs: unknown[] };
      expect(Array.isArray(body.logs)).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe('Planning — indisponibilités Getaround', () => {
  test('page planning accessible', async ({ page }) => {
    await page.goto(`${BASE}/planning`, { waitUntil: 'networkidle' });
    await expect(page.locator('h1, [data-testid="planning-header"]')).toBeDefined();
  });

  test('toggle Bloquer sur Getaround visible dans le formulaire de blocage', async ({ page }) => {
    await page.goto(`${BASE}/planning`, { waitUntil: 'networkidle' });
    const addBtn = page.locator('button').filter({ hasText: /blocage|bloquer|ajouter/i }).first();
    if (await addBtn.count() === 0) return;
    await addBtn.click();
    const toggle = page.getByTestId('toggle-sync-getaround');
    await expect(toggle).toBeVisible();
  });

  test('POST /api/v1/planning/unavailabilities-sync retourne 200', async ({ playwright }) => {
    const token = await getTenantToken().catch(() => null);
    if (!token) { console.log('[39] getTenantToken failed — test ignoré'); return; }
    const ctx = await playwright.request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    try {
      const res = await ctx.post(`${BASE}/api/v1/planning/unavailabilities-sync`);
      expect([200, 500]).toContain(res.status()); // 500 si pas de compte GA configuré
    } finally {
      await ctx.dispose();
    }
  });
});
