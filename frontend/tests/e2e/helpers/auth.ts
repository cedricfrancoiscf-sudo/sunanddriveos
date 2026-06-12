import { Page } from '@playwright/test'

export const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@sunanddrive.fr'
export const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password'
export const API_URL = process.env.BASE_URL || 'https://appli.sunanddrive.com'
export const SUPERADMIN_TOKEN = process.env.SUPERADMIN_TOKEN || ''

export async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', TEST_EMAIL)
  await page.fill('input[type="password"]', TEST_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
}

export async function simulateRental(slug = 'sun-and-drive') {
  const res = await fetch(`${API_URL}/api/v1/superadmin/tenants/${slug}/simulate-rental`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPERADMIN_TOKEN}`
    }
  })
  return res.json()
}
