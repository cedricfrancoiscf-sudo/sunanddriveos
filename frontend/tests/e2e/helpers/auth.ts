import { Page } from '@playwright/test'

export const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@sunanddrive.com'
export const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password'
export const API_URL = process.env.BASE_URL || 'https://appli.sunanddrive.com'
export const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || 'admin@sunanddriveos.com'
export const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'ChangeMe2024!'
export const TENANT_SLUG = 'sun-and-drive'

export const CARKEEPER_EMAIL = 'carkeeper.test@sunanddrive.com'
export const CARKEEPER_PASSWORD = 'CarTest2026!'

export async function getSuperadminToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/auth/superadmin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD }),
  })
  const data = await res.json() as { token?: string }
  if (!data.token) throw new Error(`Superadmin login failed: ${JSON.stringify(data)}`)
  return data.token
}

// JWT tenant via API — nécessaire car user.json stocke le token en localStorage
// (pas en cookie), donc playwright.request.newContext({ storageState }) ne le transmet pas.
export async function getTenantToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, slug: TENANT_SLUG }),
  })
  const data = await res.json() as { token?: string }
  if (!data.token) throw new Error(`Tenant login failed: ${JSON.stringify(data)}`)
  return data.token
}

export async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', TEST_EMAIL)
  await page.fill('input[type="password"]', TEST_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
}

export async function loginAsCarkeeper(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', CARKEEPER_EMAIL)
  await page.fill('input[type="password"]', CARKEEPER_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
}

export async function simulateRental(slug = TENANT_SLUG) {
  const token = await getSuperadminToken()
  const res = await fetch(`${API_URL}/api/v1/superadmin/tenants/${slug}/simulate-rental`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  })
  return res.json()
}

export async function seedTestData(slug = TENANT_SLUG) {
  const token = await getSuperadminToken()
  const res = await fetch(`${API_URL}/api/v1/superadmin/seed-test-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ slug }),
  })
  return res.json() as Promise<{ rentalsCreated: number; messagesCreated: number; renterCreated: number; carSeatRequestsTriggered: number }>
}

export async function deleteTestData(slug = TENANT_SLUG) {
  const token = await getSuperadminToken()
  // Endpoint legacy (isTest=true rentals)
  const res = await fetch(`${API_URL}/api/v1/superadmin/test-data?slug=${slug}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  })
  const result = await res.json() as Record<string, unknown>

  // Endpoint étendu (playwright-named data : maintenances, CTs, messages, NPS)
  await fetch(`${API_URL}/api/v1/superadmin/tenants/${slug}/cleanup-test-data`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  }).catch(() => { /* non bloquant */ })

  return result
}

export async function cleanupPlaywrightData(slug = TENANT_SLUG) {
  const token = await getSuperadminToken()
  const res = await fetch(`${API_URL}/api/v1/superadmin/tenants/${slug}/cleanup-test-data`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  })
  return res.json() as Promise<Record<string, unknown>>
}

// Navigue vers août 2026 depuis la page planning (suppose vue Mois, date courante juin 2026)
export async function navigatePlanningToAugust2026(page: Page) {
  const moisBtn = page.locator('button').filter({ hasText: /^Mois$/ }).first()
  if (await moisBtn.isVisible()) await moisBtn.click()
  await page.waitForTimeout(300)
  for (let i = 0; i < 2; i++) {
    const nextBtn = page.locator('button[aria-label*="suivant"], button[title*="suivant"]')
      .or(page.locator('button').filter({ hasText: /^[›>]$/ }))
      .first()
    if (await nextBtn.isVisible({ timeout: 2000 })) {
      await nextBtn.click()
      await page.waitForTimeout(400)
    }
  }
}
