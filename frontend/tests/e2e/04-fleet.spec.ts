import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test.beforeEach(async ({ page }) => {
  await login(page)
  await page.goto('/fleet')
})

test('Flotte — 7 véhicules visibles', async ({ page }) => {
  const vehicles = page.locator('[data-testid="vehicle-card"], .vehicle-item, tr')
  await expect(vehicles).toHaveCount(7, { timeout: 10000 })
})

test('Flotte — Clic véhicule → fiche', async ({ page }) => {
  await page.locator('text=FZ671YT').first().click()
  await expect(page).toHaveURL(/\/fleet\//)
})

test('Flotte — Bouton Modifier → formulaire', async ({ page }) => {
  await page.locator('text=FZ671YT').first().click()
  await page.click('button:has-text("Modifier")')
  await expect(page).toHaveURL(/\/edit/)
})

test('Flotte — Score santé non modifiable', async ({ page }) => {
  await page.locator('text=FZ671YT').first().click()
  await page.click('button:has-text("Modifier")')
  const scoreInput = page.locator('input[name="healthScore"]')
  if (await scoreInput.isVisible()) {
    await expect(scoreInput).toBeDisabled()
  }
})

test('Flotte — Modifier point de livraison', async ({ page }) => {
  await page.locator('text=FZ671YT').first().click()
  await page.click('button:has-text("Modifier")')
  await page.fill('input[name="deliveryPointName"]', 'Gare AIX TGV Test')
  await page.click('button[type="submit"], button:has-text("Sauvegarder")')
  await expect(page.locator('text=Gare AIX TGV Test')).toBeVisible()
})
