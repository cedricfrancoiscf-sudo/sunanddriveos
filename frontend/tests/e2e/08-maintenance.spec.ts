import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test.beforeEach(async ({ page }) => {
  await login(page)
  await page.goto('/maintenance')
})

test('Entretiens — Page charge', async ({ page }) => {
  await expect(page.locator('text=Entretiens')).toBeVisible()
})

test('Entretiens — Alertes visibles', async ({ page }) => {
  await expect(page.locator('text=entretien, text=à prévoir')).toBeVisible()
})

test('Entretiens — Ajouter entretien avec périodicité', async ({ page }) => {
  await page.click('button:has-text("Ajouter")')
  await page.waitForSelector('[role="dialog"], .modal, form')
  await page.selectOption('select[name="vehicleId"]', { index: 1 })
  await page.selectOption('select[name="type"]', 'vidange')
  const today = new Date().toISOString().split('T')[0]
  await page.fill('input[name="performedAt"]', today)
  await page.fill('input[name="mileageAtService"]', '100000')
  await page.fill('input[name="intervalMonths"]', '12')
  await page.fill('input[name="intervalKm"]', '15000')
  await page.fill('input[name="cost"]', '150')
  await page.click('button[type="submit"]')
  await expect(page.locator('text=vidange')).toBeVisible()
})

test('Entretiens — Entretien sans périodicité (pneus)', async ({ page }) => {
  await page.click('button:has-text("Ajouter")')
  await page.waitForSelector('[role="dialog"], .modal, form')
  await page.selectOption('select[name="vehicleId"]', { index: 1 })
  await page.selectOption('select[name="type"]', 'pneus')
  const today = new Date().toISOString().split('T')[0]
  await page.fill('input[name="performedAt"]', today)
  await page.fill('input[name="mileageAtService"]', '100000')
  await page.fill('input[name="cost"]', '400')
  await page.click('button[type="submit"]')
  await expect(page.locator('text=pneu')).toBeVisible()
})

test('Entretiens — Toggle historique', async ({ page }) => {
  const toggle = page.locator('button:has-text("historique"), text=Voir l\'historique')
  if (await toggle.isVisible()) {
    await toggle.click()
    await page.waitForTimeout(500)
  }
})
