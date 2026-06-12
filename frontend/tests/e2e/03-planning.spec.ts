import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test.beforeEach(async ({ page }) => {
  await login(page)
  await page.goto('/planning')
})

test('Planning charge sans erreur', async ({ page }) => {
  await expect(page.locator('text=Planning')).toBeVisible()
})

test('Planning — Vue Semaine', async ({ page }) => {
  await page.click('text=Semaine')
  await expect(page.locator('text=Semaine')).toBeVisible()
})

test('Planning — Vue 14 jours', async ({ page }) => {
  await page.click('text=14 jours')
  await expect(page.locator('text=14 jours')).toBeVisible()
})

test('Planning — Vue Mois', async ({ page }) => {
  await page.click('text=Mois')
  await expect(page.locator('text=Mois')).toBeVisible()
})

test('Planning — Bouton Blocage ouvre modal', async ({ page }) => {
  await page.click('text=Blocage, button:has-text("Blocage")')
  await expect(page.locator('[role="dialog"], .modal')).toBeVisible()
})

test('Planning — Créer un blocage', async ({ page }) => {
  await page.click('button:has-text("Blocage")')
  await page.waitForSelector('[role="dialog"]')
  await page.selectOption('select', { index: 1 })
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const dayAfter = new Date(Date.now() + 172800000).toISOString().split('T')[0]
  await page.fill('input[type="date"]:first-of-type', tomorrow)
  await page.fill('input[type="date"]:last-of-type', dayAfter)
  await page.click('button[type="submit"], button:has-text("Créer")')
  await expect(page.locator('[role="dialog"]')).not.toBeVisible()
})
