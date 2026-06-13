import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/settings')
})

test('Paramètres — Page charge', async ({ page }) => {
  await expect(page.locator('text=Paramètres')).toBeVisible()
})

test('Paramètres — Getaround en premier', async ({ page }) => {
  const sections = page.locator('h2, h3, .section-title')
  const firstSection = sections.first()
  await expect(firstSection).toContainText(/Getaround/)
})

test('Paramètres — Toggle messagerie sauvegardé', async ({ page }) => {
  await page.click('button:has-text("Automatique"), button:has-text("Approbation")')
  await page.waitForTimeout(500)
  await page.reload()
  await expect(page.locator('button.active, button[data-active="true"]')).toBeVisible()
})

test('Paramètres — Sections réordonnées', async ({ page }) => {
  await expect(page.locator('text=Getaround')).toBeVisible()
  await expect(page.locator('text=Messagerie automatique')).toBeVisible()
  await expect(page.locator('text=Apparence')).toBeVisible()
})
