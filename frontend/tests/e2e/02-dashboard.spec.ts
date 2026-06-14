import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('domcontentloaded')
})

test('Dashboard — KPIs visibles', async ({ page }) => {
  await expect(page.locator('main').getByText("Chiffre d'affaires")).toBeVisible()
  await expect(page.locator('main').getByText("Taux d'occupation").first()).toBeVisible()
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

test('Dashboard — Section Alertes visible', async ({ page }) => {
  // Attendre que la section Alertes soit rendue (heading h2 contenant "Alertes")
  const alertsSection = page.locator('main h2').filter({ hasText: /Alertes/i })
  await expect(alertsSection.first()).toBeVisible({ timeout: 30000 })
  // Vérifier qu'au moins une carte d'alerte OU le message "Tout est en ordre" est visible
  const alertCard = page.locator('main a').filter({
    has: page.locator('[class*="bg-red"], [class*="bg-orange"]'),
  }).first()
  const allClear = page.locator('main').getByText(/Tout est en ordre/i).first()
  const hasAlerts = await alertCard.isVisible({ timeout: 5000 }).catch(() => false)
  const nothingWrong = await allClear.isVisible({ timeout: 3000 }).catch(() => false)
  if (!hasAlerts && !nothingWrong) {
    console.log('[02] Section Alertes présente mais contenu non détecté')
  }
  expect(hasAlerts || nothingWrong).toBe(true)
})

test('Dashboard — Navigation vers alertes', async ({ page }) => {
  const alerte = page.locator('main').getByRole('link', { name: /Contrôle technique|CT expir|CT —|Entretien/i }).first()
  if (await alerte.isVisible()) {
    await alerte.click()
    await expect(page).not.toHaveURL(/dashboard/)
  }
})
