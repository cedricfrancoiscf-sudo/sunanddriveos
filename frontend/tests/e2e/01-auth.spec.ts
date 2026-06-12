import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test('Login valide → dashboard', async ({ page }) => {
  await login(page)
  await expect(page).toHaveURL(/dashboard/)
  await expect(page.locator('text=Tableau de bord')).toBeVisible()
})

test('Login invalide → message erreur', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'faux@email.com')
  await page.fill('input[type="password"]', 'mauvais')
  await page.click('button[type="submit"]')
  await expect(page.locator('.error, [role="alert"], text=incorrect, text=invalide')).toBeVisible()
})

test('Déconnexion → retour login', async ({ page }) => {
  await login(page)
  await page.click('[data-testid="logout"], text=Déconnexion, button:has-text("logout")')
  await expect(page).toHaveURL(/login/)
})
