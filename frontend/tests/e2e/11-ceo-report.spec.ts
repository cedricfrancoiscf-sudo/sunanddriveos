import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/intelligence/report')
  await page.waitForLoadState('networkidle')
})

test('Rapport CEO — Page charge', async ({ page }) => {
  await expect(page.locator('main').getByRole('heading', { name: /Rapport CEO/ }).first()).toBeVisible()
})

test('Rapport CEO — Sidebar lien Rapport CEO visible', async ({ page }) => {
  const reportLink = page.locator('nav').getByRole('link', { name: /Rapport CEO/ })
  await expect(reportLink).toBeVisible()
})

test('Rapport CEO — Toggle Mensuel/Annuel', async ({ page }) => {
  const mensuelBtn = page.getByRole('button', { name: 'Mensuel' })
  const annuelBtn = page.getByRole('button', { name: 'Annuel' })
  if (await mensuelBtn.isVisible()) {
    await mensuelBtn.click()
    await page.waitForTimeout(500)
  }
  if (await annuelBtn.isVisible()) {
    await annuelBtn.click()
    await page.waitForTimeout(500)
  }
})

test('Rapport CEO — Générer rapport annuel', async ({ page }) => {
  const genBtn = page.getByRole('button', { name: /Générer/ })
  if (await genBtn.isVisible()) {
    await genBtn.click()
    const hasContent = await page.getByText(/Résumé exécutif|SWOT|Bilan mensuel/).isVisible({ timeout: 120000 })
    expect(hasContent).toBeTruthy()
  } else {
    await expect(page.getByText(/Résumé exécutif|Bilan mensuel/)).toBeVisible()
  }
})
