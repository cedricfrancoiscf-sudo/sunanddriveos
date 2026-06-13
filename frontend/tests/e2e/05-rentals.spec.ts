import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/rentals')
})

test('Locations — Page charge', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Locations' })).toBeVisible()
})

test('Locations — Filtre statut', async ({ page }) => {
  await page.getByRole('combobox').nth(1).selectOption('Terminées')
  await page.waitForTimeout(1000)
  await expect(page.locator('main').getByText('Terminée').first()).toBeVisible()
})

test('Locations — Clic → fiche location', async ({ page }) => {
  await page.locator('main').getByRole('link').first().click()
  await expect(page).toHaveURL(/\/rentals\//)
})
