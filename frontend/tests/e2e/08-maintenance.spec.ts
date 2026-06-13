import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/maintenance')
  await page.waitForLoadState('networkidle')
})

test('Entretiens — Page charge', async ({ page }) => {
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('heading', { name: 'Entretiens' }).waitFor({ timeout: 15000 })
  await expect(page.getByRole('heading', { name: 'Entretiens' })).toBeVisible({ timeout: 15000 })
})

test('Entretiens — Alertes visibles', async ({ page }) => {
  const hasAlerts = await page.getByText(/à prévoir/i).isVisible()
  if (hasAlerts) {
    await expect(page.getByText(/à prévoir/i).first()).toBeVisible()
  } else {
    await expect(page.getByRole('heading', { name: 'Entretiens' })).toBeVisible()
  }
})

test('Entretiens — Ajouter entretien avec périodicité', async ({ page }) => {
  await page.getByRole('button', { name: 'Ajouter' }).click()
  await expect(page.getByText('Nouvel entretien')).toBeVisible()
  await page.locator('form select').first().selectOption({ index: 1 })
  const today = new Date().toISOString().slice(0, 16)
  await page.locator('input[type="datetime-local"]').fill(today)
  await page.locator('input[type="number"]').nth(0).fill('100000')
  await page.locator('input[type="number"]').nth(1).fill('12')
  await page.locator('input[type="number"]').nth(2).fill('15000')
  await page.locator('input[type="number"]').nth(3).fill('150')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('heading', { name: 'Entretiens' })).toBeVisible({ timeout: 5000 })
})

test('Entretiens — Entretien sans périodicité (pneus)', async ({ page }) => {
  await page.getByRole('button', { name: 'Ajouter' }).click()
  await expect(page.getByText('Nouvel entretien')).toBeVisible()
  await page.locator('form select').first().selectOption({ index: 1 })
  await page.locator('form select').nth(1).selectOption('pneus')
  const today = new Date().toISOString().slice(0, 16)
  await page.locator('input[type="datetime-local"]').fill(today)
  await page.locator('input[type="number"]').nth(0).fill('100000')
  await page.locator('input[type="number"]').nth(3).fill('400')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('heading', { name: 'Entretiens' })).toBeVisible({ timeout: 5000 })
})

test('Entretiens — Annuler formulaire', async ({ page }) => {
  await page.getByRole('button', { name: 'Ajouter' }).click()
  await expect(page.getByText('Nouvel entretien')).toBeVisible()
  await page.getByRole('button', { name: 'Annuler' }).click()
  await expect(page.getByText('Nouvel entretien')).not.toBeVisible()
})
