import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/rentals')
  await page.waitForLoadState('domcontentloaded')
})

test('Locations — Page charge', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Locations' })).toBeVisible()
})

test('Locations — Recherche par locataire', async ({ page }) => {
  const searchBox = page.getByRole('textbox', { name: /Rechercher/ })
  await searchBox.fill('Fiat')
  await page.waitForTimeout(500)
  await expect(page.locator('main').getByText(/Fiat/).first()).toBeVisible()
})

test('Locations — Navigation mois précédent', async ({ page }) => {
  const prevBtn = page.locator('main').getByRole('button').first()
  await prevBtn.click()
  await page.waitForTimeout(500)
  await expect(page.getByRole('heading', { name: 'Locations' })).toBeVisible()
})

test('Locations — Clic → fiche location', async ({ page }) => {
  await page.locator('main').getByRole('link').first().click()
  await expect(page).toHaveURL(/\/rentals\//)
})
