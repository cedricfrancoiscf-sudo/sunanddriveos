import { test, expect } from '@playwright/test';

test.use({ storageState: 'tests/e2e/.auth/user.json' });

const BASE = 'https://appli.sunanddrive.com';

async function apiGet(page: import('@playwright/test').Page, path: string) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  const resp = await page.request.get(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  });
  return resp;
}

async function apiPut(page: import('@playwright/test').Page, path: string, body: unknown) {
  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  return page.request.put(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' },
    data: body,
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/vehicles`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
});

// ─── BLOC 4 : seuil configurable ───────────────────────────────────────────

test('44-01 inbox-summary — unansweredDelayMs === 30 * 60 * 1000 (défaut)', async ({ page }) => {
  const resp = await apiGet(page, '/api/v1/messages/inbox-summary');
  expect(resp.status()).toBe(200);
  const body = await resp.json() as { unansweredDelayMs: number };
  expect(body.unansweredDelayMs).toBe(30 * 60 * 1000);
});

test('44-02 GET /api/v1/settings — champ messageUnansweredMinutes présent', async ({ page }) => {
  const resp = await apiGet(page, '/api/v1/settings');
  expect(resp.status()).toBe(200);
  const body = await resp.json() as { settings: Record<string, unknown> };
  expect('messageUnansweredMinutes' in body.settings).toBe(true);
});

test('44-03 PATCH messageUnansweredMinutes=60 → inbox-summary retourne 3 600 000 ms', async ({ page }) => {
  // Save 60 minutes
  const putResp = await apiPut(page, '/api/v1/settings', { messageUnansweredMinutes: 60 });
  expect(putResp.status()).toBe(200);

  const resp = await apiGet(page, '/api/v1/messages/inbox-summary');
  expect(resp.status()).toBe(200);
  const body = await resp.json() as { unansweredDelayMs: number };
  expect(body.unansweredDelayMs).toBe(60 * 60 * 1000);

  // Remettre null (défaut 30 min)
  await apiPut(page, '/api/v1/settings', { messageUnansweredMinutes: null });
});

test('44-04 PATCH messageUnansweredMinutes=4 → erreur 400 (min 5)', async ({ page }) => {
  const resp = await apiPut(page, '/api/v1/settings', { messageUnansweredMinutes: 4 });
  expect(resp.status()).toBe(400);
});

test('44-05 PATCH messageUnansweredMinutes=241 → erreur 400 (max 240)', async ({ page }) => {
  const resp = await apiPut(page, '/api/v1/settings', { messageUnansweredMinutes: 241 });
  expect(resp.status()).toBe(400);
});

// ─── BLOC 4F : champ UI dans paramètres ────────────────────────────────────

test('44-06 SettingsPage — champ "Délai avant alerte message sans réponse" visible', async ({ page }) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect(page.getByText(/Délai avant alerte message sans réponse/i)).toBeVisible({ timeout: 10_000 });
});

// ─── BLOC 4D : MessageListPage utilise le délai configurable ───────────────

test('44-07 MessageListPage se charge sans erreur', async ({ page }) => {
  await page.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  // Vérifier que la page se charge (header présent)
  await expect(page.getByRole('heading', { name: /Messages/i })).toBeVisible({ timeout: 8_000 });
});

// ─── BLOC 2 : vérifier que messages inbound status=sent sont bien traités ──

test('44-08 inbox-summary structure complète (pendingCount, unansweredRentals, unansweredDelayMs)', async ({ page }) => {
  const resp = await apiGet(page, '/api/v1/messages/inbox-summary');
  expect(resp.status()).toBe(200);
  const body = await resp.json() as Record<string, unknown>;
  expect(typeof body.pendingCount).toBe('number');
  expect(typeof body.unansweredRentals).toBe('number');
  expect(typeof body.unansweredDelayMs).toBe('number');
  expect(body.unansweredDelayMs).toBeGreaterThan(0);
});
