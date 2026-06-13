import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/vehicles')
})

test('Flotte — 7 véhicules visibles', async ({ page }) => {
  await page.waitForLoadState('networkidle')
  const vehicles = page.locator('main').locator('a[href*="/vehicles/"]')
  await expect(vehicles).toHaveCount(7, { timeout: 10000 })
})

test('Flotte — Clic véhicule → fiche', async ({ page }) => {
  await page.locator('main').getByText('FZ671YT').first().click()
  await expect(page).toHaveURL(/\/vehicles\//)
})

test('Flotte — Bouton Modifier → formulaire', async ({ page }) => {
  await page.locator('main').getByText('FZ671YT').first().click()
  await page.getByRole('button', { name: /Modifier/i }).click()
  await expect(page).toHaveURL(/\/edit/)
})

test('Flotte — Score santé non modifiable', async ({ page }) => {
  await page.locator('main').getByText('FZ671YT').first().click()
  await page.getByRole('button', { name: /Modifier/i }).click()
  const scoreInput = page.locator('input[name="healthScore"]')
  if (await scoreInput.isVisible()) {
    await expect(scoreInput).toBeDisabled()
  }
})

test('Flotte — Modifier point de livraison', async ({ page }) => {
  await page.locator('main').getByText('FZ671YT').first().click()
  await page.getByRole('button', { name: /Modifier/i }).click()
  await page.fill('input[name="deliveryPointName"]', 'Gare AIX TGV Test')
  await page.getByRole('button', { name: /Sauvegarder|Enregistrer/i }).click()
  await expect(page.getByText('Gare AIX TGV Test')).toBeVisible()
})
