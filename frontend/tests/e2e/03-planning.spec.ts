import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/planning')
})

test('Planning charge sans erreur', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible()
})

test('Planning — Vue Semaine', async ({ page }) => {
  await page.getByRole('button', { name: 'Semaine' }).click()
  await expect(page.getByRole('button', { name: 'Semaine' })).toBeVisible()
})

test('Planning — Vue 14 jours', async ({ page }) => {
  await page.getByRole('button', { name: '14 jours' }).click()
  await expect(page.getByRole('button', { name: '14 jours' })).toBeVisible()
})

test('Planning — Vue Mois', async ({ page }) => {
  await page.getByRole('button', { name: 'Mois' }).click()
  await expect(page.getByRole('button', { name: 'Mois' })).toBeVisible()
})

test('Planning — Bouton Blocage ouvre modal', async ({ page }) => {
  await page.getByRole('button', { name: 'Blocage' }).click()
  await expect(page.locator('[role="dialog"]')).toBeVisible()
})

test('Planning — Créer un blocage', async ({ page }) => {
  await page.getByRole('button', { name: 'Blocage' }).click()
  await page.waitForSelector('[role="dialog"]')
  await page.selectOption('select', { index: 1 })
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const dayAfter = new Date(Date.now() + 172800000).toISOString().split('T')[0]
  await page.fill('input[type="date"]:first-of-type', tomorrow)
  await page.fill('input[type="date"]:last-of-type', dayAfter)
  await page.getByRole('button', { name: /Créer|Confirmer|Enregistrer/i }).click()
  await expect(page.locator('[role="dialog"]')).not.toBeVisible()
})
