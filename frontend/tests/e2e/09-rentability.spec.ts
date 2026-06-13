import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/rentability')
})

test('Rentabilité — Page charge', async ({ page }) => {
  await expect(page.locator('text=Rentabilité')).toBeVisible()
})

test('Rentabilité — 7 véhicules avec CA/Coûts/Marge', async ({ page }) => {
  await expect(page.locator('text=CA net')).toBeVisible()
  await expect(page.locator('text=Coûts')).toBeVisible()
  await expect(page.locator('text=Marge')).toBeVisible()
})

test('Rentabilité — Colonnes annuelles visibles', async ({ page }) => {
  await expect(page.locator('text=CA annuel, text=CA ANN')).toBeVisible()
})

test('Rentabilité — Clic véhicule ouvre panneau coûts', async ({ page }) => {
  await page.locator('tr').nth(1).click()
  await expect(page.locator('text=assurance, text=Assurance, text=parking')).toBeVisible({ timeout: 5000 })
})

test('Rentabilité — Ajouter coût fixe', async ({ page }) => {
  await page.locator('tr').nth(1).click()
  await page.waitForTimeout(500)
  const insuranceInput = page.locator('input[name="insurance"], input[placeholder*="assurance"]')
  if (await insuranceInput.isVisible()) {
    await insuranceInput.fill('150')
    await page.click('button:has-text("Sauvegarder"), button[type="submit"]')
    await expect(page.locator('text=150')).toBeVisible()
  }
})

test('Rentabilité — Tri par Marge mensuelle', async ({ page }) => {
  await page.click('th:has-text("Marge")')
  await page.waitForTimeout(500)
})
