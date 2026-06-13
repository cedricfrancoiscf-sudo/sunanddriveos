import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/intelligence/report')
  await page.waitForLoadState('domcontentloaded')
})

test('Rapport CEO — Page charge', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Rapport CEO/, level: 1 })).toBeVisible({ timeout: 10000 })
})

test('Rapport CEO — Sidebar lien Rapport CEO visible', async ({ page }) => {
  const reportLink = page.locator('nav').getByRole('link', { name: /Rapport CEO/ })
  await expect(reportLink).toBeVisible()
})

test('Rapport CEO — Toggle Mensuel/Annuel', async ({ page }) => {
  const mensuelBtn = page.getByRole('button', { name: /Mensuel/ })
  const annuelBtn = page.getByRole('button', { name: /Annuel/ })
  if (await mensuelBtn.isVisible()) {
    await mensuelBtn.click()
    await page.waitForTimeout(500)
  }
  if (await annuelBtn.isVisible()) {
    await annuelBtn.click()
    await page.waitForTimeout(500)
  }
  await expect(page.getByRole('heading', { name: /Rapport CEO/, level: 1 })).toBeVisible()
})

test('Rapport CEO — Contenu rapport visible', async ({ page }) => {
  await expect(page.getByText(/Résumé exécutif|Bilan mensuel/)).toBeVisible({ timeout: 10000 })
})
