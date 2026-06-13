import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => { await page.goto('/planning') })

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
  await expect(page.getByText('Nouveau blocage')).toBeVisible()
})

test('Planning — Fermer form blocage', async ({ page }) => {
  await page.getByRole('button', { name: 'Blocage' }).click()
  await expect(page.getByText('Nouveau blocage')).toBeVisible()
  await page.getByRole('button', { name: 'Annuler' }).click()
  await expect(page.getByText('Nouveau blocage')).not.toBeVisible()
})
