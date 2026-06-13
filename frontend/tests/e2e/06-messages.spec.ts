import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/messages')
})

test('Messages — Page charge', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible()
})

test('Messages — Pas de bouton Analyser IA', async ({ page }) => {
  await expect(page.getByRole('button', { name: /Analyser/i })).not.toBeVisible()
})

test('Messages — Pas de bouton Suggérer', async ({ page }) => {
  await expect(page.getByRole('button', { name: /Suggérer/i })).not.toBeVisible()
})

test('Messages — Clic conversation → détail', async ({ page }) => {
  await page.waitForLoadState('domcontentloaded')
  const conv = page.locator('main').getByRole('button').first()
  if (await conv.isVisible()) {
    await conv.click()
    await page.waitForURL(/\/messages\//, { timeout: 10000 })
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10000 })
  }
})
