import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test.beforeEach(async ({ page }) => {
  await login(page)
  await page.goto('/intelligence/report')
})

test('Rapport CEO — Page charge', async ({ page }) => {
  await expect(page.locator('text=Rapport CEO')).toBeVisible()
})

test('Rapport CEO — Sidebar actif sur Rapport CEO', async ({ page }) => {
  const reportLink = page.locator('nav a:has-text("Rapport CEO")')
  await expect(reportLink).toHaveClass(/active/)
})

test('Rapport CEO — Toggle Mensuel/Annuel', async ({ page }) => {
  await page.click('button:has-text("Mensuel")')
  await page.waitForTimeout(500)
  await page.click('button:has-text("Annuel")')
  await page.waitForTimeout(500)
})

test('Rapport CEO — Générer rapport annuel', async ({ page }) => {
  const genBtn = page.locator('button:has-text("Générer")')
  if (await genBtn.isVisible()) {
    await genBtn.click()
    await expect(page.locator('text=Résumé exécutif, text=SWOT')).toBeVisible({ timeout: 120000 })
  } else {
    await expect(page.locator('text=Résumé exécutif')).toBeVisible()
  }
})
