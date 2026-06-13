import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/settings')
  await page.waitForLoadState('domcontentloaded')
})

test('Paramètres — Page charge', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Paramètres' })).toBeVisible({ timeout: 10000 })
})

test('Paramètres — Section Getaround visible', async ({ page }) => {
  await expect(page.locator('main').getByText(/Getaround/).first()).toBeVisible({ timeout: 10000 })
})

test('Paramètres — Toggle messagerie fonctionne', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Paramètres' })).toBeVisible({ timeout: 10000 })
  const autoBtn = page.getByRole('button', { name: /Automatique/i }).first()
  const approvalBtn = page.getByRole('button', { name: /Approbation/i })
  if (await autoBtn.isVisible()) {
    await autoBtn.click()
    await page.waitForTimeout(500)
    await expect(page.getByRole('heading', { name: 'Paramètres' })).toBeVisible()
  } else if (await approvalBtn.isVisible()) {
    await approvalBtn.click()
    await page.waitForTimeout(500)
    await expect(page.getByRole('heading', { name: 'Paramètres' })).toBeVisible()
  }
})

test('Paramètres — Sections principales visibles', async ({ page }) => {
  await expect(page.locator('main').getByText(/Getaround/).first()).toBeVisible({ timeout: 10000 })
  await expect(page.locator('main').getByText(/Messagerie automatique/i).first()).toBeVisible()
  await expect(page.locator('main').getByText(/Apparence/i).first()).toBeVisible()
})
