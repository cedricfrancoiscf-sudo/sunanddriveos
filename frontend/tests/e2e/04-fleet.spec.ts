import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => { await page.goto('/vehicles') })

test('Flotte — véhicules visibles', async ({ page }) => {
  await page.waitForLoadState('domcontentloaded')
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
  const deliveryInput = page.locator('input[name="deliveryPointName"]')
  await expect(deliveryInput).toBeVisible({ timeout: 10000 })
  await deliveryInput.fill('Gare AIX TGV Test')
  await page.getByRole('button', { name: /Sauvegarder|Enregistrer/i }).click()
  await expect(page.getByText('Gare AIX TGV Test')).toBeVisible()
})
