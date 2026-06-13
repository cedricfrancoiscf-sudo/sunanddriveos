import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
})

test('Dashboard — KPIs visibles', async ({ page }) => {
  await expect(page.locator('main').getByText("Chiffre d'affaires")).toBeVisible()
  await expect(page.locator('main').getByText("Taux d'occupation")).toBeVisible()
  await expect(page.locator('main').getByRole('link', { name: /Locations/ })).toBeVisible()
  await expect(page.locator('main').getByText('Km parcourus')).toBeVisible()
})

test('Dashboard — Copilote IA visible', async ({ page }) => {
  await expect(page.locator('main').getByText(/✨/)).toBeVisible({ timeout: 15000 })
})

test('Dashboard — Comparaison N-1 visible', async ({ page }) => {
  await expect(page.locator('main').getByText(/Même période/)).toBeVisible({ timeout: 10000 })
})

test('Dashboard — Graphique occupation visible', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Occupation par véhicule/i })).toBeVisible()
})

test('Dashboard — Alertes CT visibles', async ({ page }) => {
  await expect(page.locator('main').getByText(/CT/).first()).toBeVisible()
})

test('Dashboard — Navigation vers alertes', async ({ page }) => {
  const alerte = page.locator('main').getByRole('link', { name: /CT|Entretien/ }).first()
  if (await alerte.isVisible()) {
    await alerte.click()
    await expect(page).not.toHaveURL(/dashboard/)
  }
})
