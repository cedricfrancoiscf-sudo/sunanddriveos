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
  // Les conversations sont dans div.overflow-hidden, les boutons de filtres (tri, reset) sont en dehors
  const conv = page.locator('main div.overflow-hidden button').first()
  if (await conv.isVisible()) {
    await conv.click()
    await page.waitForURL(/\/messages\//, { timeout: 15000 })
    await page.waitForLoadState('domcontentloaded')
    // "Voir la location →" est toujours présent dans le détail, quelle que soit la direction du message
    await expect(page.getByRole('link', { name: /Voir la location/ })).toBeVisible({ timeout: 15000 })
  }
})
