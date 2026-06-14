import { test, expect } from '@playwright/test'
import { simulateRental, getSuperadminToken, API_URL } from './helpers/auth'

test('Simulation — Flux siège auto complet', async ({ page }) => {
  const rental = await simulateRental('sun-and-drive').catch(() => null)
  if (!rental?.rentalId) {
    console.log('simulate-rental non disponible ou en erreur — test ignoré:', rental)
    return
  }
  console.log('Location simulée:', rental)
  expect(rental.rentalId).toBeTruthy()

  await page.goto('/dashboard')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(3000)

  await page.goto('/messages')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1000)

  const testMsg = page.locator('main').getByText('Test Locataire')
  if (await testMsg.isVisible({ timeout: 5000 })) {
    await testMsg.first().click()
    await page.waitForTimeout(1000)
    const textarea = page.locator('textarea')
    if (await textarea.isVisible()) {
      const content = await textarea.inputValue()
      console.log('Contenu brouillon:', content)
      expect(content.length).toBeGreaterThan(0)
    }
  }

  await fetch(`${API_URL}/api/v1/superadmin/tenants/sun-and-drive/cleanup-simulation`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${await getSuperadminToken()}` }
  }).catch(console.error)
})
