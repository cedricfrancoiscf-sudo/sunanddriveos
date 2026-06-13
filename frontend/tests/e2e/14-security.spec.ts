import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test('Sécurité — Accès sans JWT → 401', async ({ page }) => {
  const res = await page.request.get(`${process.env.BASE_URL}/api/v1/dashboard/stats`)
  expect(res.status()).toBe(401)
})

test('Sécurité — JWT invalide → 401', async ({ page }) => {
  const res = await page.request.get(
    `${process.env.BASE_URL}/api/v1/dashboard/stats`,
    { headers: { Authorization: 'Bearer faketoken123' } }
  )
  expect(res.status()).toBe(401)
})

test('Sécurité — Page login accessible sans auth', async ({ page }) => {
  await page.goto('/login')
  await expect(page).toHaveURL(/login/)
  await expect(page.locator('input[type="email"]')).toBeVisible()
})

test.describe('Sécurité — contexte non authentifié', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('Sécurité — Dashboard redirige si non connecté', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/login/, { timeout: 10000 })
  })
})
