import { test, expect } from '@playwright/test'
import { login, simulateRental, API_URL, SUPERADMIN_TOKEN } from './helpers/auth'

test('Simulation — Flux siège auto complet', async ({ page }) => {
  await login(page)

  await page.goto('/accessories')
  await page.waitForTimeout(1000)

  const rental = await simulateRental('sun-and-drive')
  console.log('Location simulée:', rental)
  expect(rental.rentalId).toBeTruthy()

  await page.waitForTimeout(5000)

  await page.goto('/dashboard')
  await page.waitForTimeout(2000)
  const alerteVisible = await page.locator(
    'text=Brouillon, text=siège, text=Message'
  ).isVisible()
  console.log('Alerte visible:', alerteVisible)

  await page.goto('/messages')
  await page.waitForTimeout(1000)
  await expect(page.locator('text=Test Locataire')).toBeVisible({ timeout: 10000 })

  await page.locator('text=Test Locataire').click()
  await page.waitForTimeout(1000)

  const textarea = page.locator('textarea')
  const content = await textarea.inputValue()
  console.log('Contenu brouillon:', content)
  expect(content.length).toBeGreaterThan(0)

  await fetch(`${API_URL}/api/v1/superadmin/tenants/sun-and-drive/cleanup-simulation`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${SUPERADMIN_TOKEN}` }
  })
})
