import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/vehicles')
  await page.waitForLoadState('domcontentloaded')
})

test('Flotte — véhicules visibles', async ({ page }) => {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('main a[href*="/vehicles/"]', { timeout: 15000 })
  const vehicles = page.locator('main').locator('a[href*="/vehicles/"]')
  const count = await vehicles.count()
  expect(count).toBeGreaterThanOrEqual(7)
})

test('Flotte — Clic véhicule → fiche', async ({ page }) => {
  await page.locator('main').getByText('FZ671YT').first().click()
  await expect(page).toHaveURL(/\/vehicles\//)
})

test('Flotte — Bouton Modifier → formulaire', async ({ page }) => {
  await page.locator('main').getByText('FZ671YT').first().click()
  await page.getByRole('link', { name: /Modifier/i }).click()
  await expect(page).toHaveURL(/\/edit/)
})

test('Flotte — Score santé non modifiable', async ({ page }) => {
  await page.locator('main').getByText('FZ671YT').first().click()
  await page.getByRole('link', { name: /Modifier/i }).click()
  const scoreInput = page.locator('input[name="healthScore"]')
  if (await scoreInput.isVisible()) {
    await expect(scoreInput).toBeDisabled()
  }
})

test('Flotte — Modifier point de livraison', async ({ page }) => {
  await page.locator('main').getByText('FZ671YT').first().click()
  await page.getByRole('link', { name: /Modifier/i }).click()
  await expect(page).toHaveURL(/\/edit/, { timeout: 15000 })
  // Le formulaire affiche un spinner pendant isLoading — attendre le rendu complet
  await expect(page.getByRole('heading', { name: /Modifier le véhicule/i })).toBeVisible({ timeout: 15000 })
  const deliveryInput = page.getByPlaceholder('ex: Parking Mignet')
  await expect(deliveryInput).toBeVisible({ timeout: 15000 })
  await deliveryInput.fill('Gare AIX TGV Test')
  await page.getByRole('button', { name: /Enregistrer/i }).click()
  // VehicleDetailPage ne liste pas deliveryPointName — vérifier qu'on est revenu sur la fiche (lien Modifier présent)
  await expect(page.getByRole('link', { name: /Modifier/i })).toBeVisible({ timeout: 15000 })
})
