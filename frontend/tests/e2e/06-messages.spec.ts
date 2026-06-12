import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test.beforeEach(async ({ page }) => {
  await login(page)
  await page.goto('/messages')
})

test('Messages — Page charge', async ({ page }) => {
  await expect(page.locator('text=Messages')).toBeVisible()
})

test('Messages — Pas de bouton Analyser IA', async ({ page }) => {
  await expect(page.locator('button:has-text("Analyser")')).not.toBeVisible()
})

test('Messages — Pas de bouton Suggérer', async ({ page }) => {
  await expect(page.locator('button:has-text("Suggérer")')).not.toBeVisible()
})

test('Messages — Clic conversation → détail', async ({ page }) => {
  const conv = page.locator('.conversation, tr, [data-testid="message-item"]').first()
  if (await conv.isVisible()) {
    await conv.click()
    await expect(page.locator('textarea, .reply-zone')).toBeVisible()
  }
})
