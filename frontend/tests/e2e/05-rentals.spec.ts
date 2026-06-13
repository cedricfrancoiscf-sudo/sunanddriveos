import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/rentals')
})

test('Locations — Page charge', async ({ page }) => {
  await expect(page.locator('text=Locations')).toBeVisible()
})

test('Locations — Filtre statut', async ({ page }) => {
  await page.selectOption('select', 'completed')
  await page.waitForTimeout(1000)
  await expect(page.locator('text=completed, text=Terminée')).toBeVisible()
})

test('Locations — Clic → fiche location', async ({ page }) => {
  await page.locator('tr, .rental-item').first().click()
  await expect(page).toHaveURL(/\/rentals\//)
})
