import { Page } from '@playwright/test'

export const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@sunanddrive.fr'
export const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password'
export const API_URL = process.env.BASE_URL || 'https://appli.sunanddrive.com'
export const SUPERADMIN_TOKEN = process.env.SUPERADMIN_TOKEN || ''
export const TENANT_SLUG = 'sun-and-drive'

export const CARKEEPER_EMAIL = 'carkeeper.test@sunanddrive.fr'
export const CARKEEPER_PASSWORD = 'CarTest2026!'

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
  const res = await fetch(`${API_URL}/api/v1/superadmin/tenants/${slug}/simulate-rental`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPERADMIN_TOKEN}` },
  })
  return res.json()
}

export async function seedTestData(slug = TENANT_SLUG) {
  const res = await fetch(`${API_URL}/api/v1/superadmin/seed-test-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPERADMIN_TOKEN}` },
    body: JSON.stringify({ slug }),
  })
  return res.json() as Promise<{ rentalsCreated: number; messagesCreated: number; renterCreated: number; carSeatRequestsTriggered: number }>
}

export async function deleteTestData(slug = TENANT_SLUG) {
  const res = await fetch(`${API_URL}/api/v1/superadmin/test-data?slug=${slug}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${SUPERADMIN_TOKEN}` },
  })
  return res.json()
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
