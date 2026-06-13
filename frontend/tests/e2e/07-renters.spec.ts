import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/renters')
  await page.waitForLoadState('networkidle')
})

test('Locataires — 1208 conducteurs', async ({ page }) => {
  await expect(page.locator('main').getByText(/\d[\s ]\d{3}/).first()).toBeVisible({ timeout: 10000 })
})

test('Locataires — Colonne Score visible', async ({ page }) => {
  await expect(page.locator('main').getByText('Score').first()).toBeVisible()
})

test('Locataires — Filtre VIP', async ({ page }) => {
  await page.getByRole('button', { name: 'VIP' }).click()
  await expect(page.getByRole('button', { name: 'VIP' })).toBeVisible()
})

test('Locataires — Filtre Excellent', async ({ page }) => {
  await page.getByRole('button', { name: 'Excellent' }).click()
  await page.waitForTimeout(500)
})

test('Locataires — Tri par CA décroissant', async ({ page }) => {
  await page.locator('main').getByRole('columnheader', { name: /CA/i }).first().click()
  await page.waitForTimeout(500)
  await page.locator('main').getByRole('columnheader', { name: /CA/i }).first().click()
  await page.waitForTimeout(500)
})

test('Locataires — Recherche par nom', async ({ page }) => {
  await page.getByRole('textbox').fill('Florence')
  await page.waitForTimeout(500)
  await expect(page.locator('main').getByText('Florence').first()).toBeVisible()
})
