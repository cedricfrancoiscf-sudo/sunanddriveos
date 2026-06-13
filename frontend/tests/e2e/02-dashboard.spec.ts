import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/dashboard')
})

test('Dashboard — KPIs visibles', async ({ page }) => {
  await expect(page.locator('text=CHIFFRE D\'AFFAIRES')).toBeVisible()
  await expect(page.locator('text=TAUX D\'OCCUPATION')).toBeVisible()
  await expect(page.locator('text=LOCATIONS')).toBeVisible()
  await expect(page.locator('text=KM PARCOURUS')).toBeVisible()
})

test('Dashboard — Copilote IA visible', async ({ page }) => {
  await expect(page.locator('text=✨')).toBeVisible({ timeout: 15000 })
})

test('Dashboard — Comparaison N-1 visible', async ({ page }) => {
  await expect(page.locator('text=Même période')).toBeVisible()
})

test('Dashboard — Graphique occupation visible', async ({ page }) => {
  await expect(page.locator('text=OCCUPATION PAR VÉHICULE')).toBeVisible()
})

test('Dashboard — Alertes CT visibles', async ({ page }) => {
  await expect(page.locator('text=CT')).toBeVisible()
})

test('Dashboard — Navigation vers alertes', async ({ page }) => {
  const alerte = page.locator('.alert, [data-testid="alert"]').first()
  if (await alerte.isVisible()) {
    await alerte.click()
    await expect(page).not.toHaveURL(/dashboard/)
  }
})
