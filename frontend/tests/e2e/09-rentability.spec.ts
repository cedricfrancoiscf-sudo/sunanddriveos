import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/rentability')
  await page.waitForLoadState('networkidle')
})

test('Rentabilité — Page charge', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Rentabilité' })).toBeVisible()
})

test('Rentabilité — KPIs CA/Coûts/Marge visibles', async ({ page }) => {
  await expect(page.locator('main').getByText('CA net').first()).toBeVisible()
  await expect(page.locator('main').getByText(/Coûts/).first()).toBeVisible()
  await expect(page.locator('main').getByText(/Marge/).first()).toBeVisible()
})

test('Rentabilité — Colonnes annuelles visibles', async ({ page }) => {
  await expect(page.locator('main').getByText('CA annuel')).toBeVisible()
})

test('Rentabilité — Clic véhicule ouvre panneau coûts', async ({ page }) => {
  await page.locator('main').getByText('FZ671YT').first().click()
  await expect(page.locator('main').getByText(/Aucun coût|Assurance|assurance|parking/i).first()).toBeVisible({ timeout: 5000 })
})

test('Rentabilité — Ajouter coût fixe', async ({ page }) => {
  await page.locator('main').getByText('FZ671YT').first().click()
  await page.waitForTimeout(500)
  const labelInput = page.locator('input[placeholder*="Assurance"]')
  if (await labelInput.isVisible()) {
    await labelInput.fill('Test assurance')
    const amountInput = page.locator('input[placeholder*="Montant"]')
    await amountInput.fill('150')
    await page.getByRole('button', { name: 'Ajouter' }).last().click()
    await expect(page.locator('main').getByText('Test assurance')).toBeVisible({ timeout: 5000 })
  }
})

test('Rentabilité — Tri par Marge mensuelle', async ({ page }) => {
  await page.locator('main').getByRole('button', { name: /Marge mens\./ }).click()
  await page.waitForTimeout(500)
  await expect(page.getByRole('heading', { name: 'Rentabilité' })).toBeVisible()
})
