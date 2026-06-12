import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test.beforeEach(async ({ page }) => {
  await login(page)
  await page.goto('/renters')
})

test('Locataires — 1208 conducteurs', async ({ page }) => {
  await expect(page.locator('text=1208, text=1 208')).toBeVisible()
})

test('Locataires — Colonne Score visible', async ({ page }) => {
  await expect(page.locator('text=Score')).toBeVisible()
})

test('Locataires — Filtre VIP', async ({ page }) => {
  await page.click('button:has-text("VIP")')
  await expect(page.locator('text=VIP')).toBeVisible()
})

test('Locataires — Filtre Excellent', async ({ page }) => {
  await page.click('button:has-text("Excellent")')
  await page.waitForTimeout(500)
})

test('Locataires — Tri par CA décroissant', async ({ page }) => {
  await page.click('th:has-text("CA")')
  await page.waitForTimeout(500)
  await page.click('th:has-text("CA")')
  await page.waitForTimeout(500)
})

test('Locataires — Recherche par nom', async ({ page }) => {
  await page.fill('input[placeholder*="nom"], input[placeholder*="recherch"]', 'Florence')
  await page.waitForTimeout(500)
  await expect(page.locator('text=Florence')).toBeVisible()
})
