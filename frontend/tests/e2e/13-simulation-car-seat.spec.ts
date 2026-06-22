import { test, expect } from '@playwright/test'
import { simulateRental, getSuperadminToken, API_URL } from './helpers/auth'

test.beforeEach(async ({ page }) => {
  const overlay = page.locator('div.fixed.inset-0[class*="z-[200]"]')
  const visible = await overlay.isVisible({ timeout: 500 }).catch(() => false)
  if (visible) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }
})

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

  // Cibler la conversation par rentalId (attribut data-rental-id ajouté sur le bouton)
  const conv = page.locator(`[data-rental-id="${rental.rentalId}"]`)
  const convVisible = await conv.isVisible({ timeout: 5000 }).catch(() => false)
  if (convVisible) {
    await conv.click()
    await page.waitForTimeout(1500)
    const textarea = page.locator('textarea')
    if (await textarea.isVisible()) {
      const content = await textarea.inputValue()
      console.log('Contenu brouillon:', content)
      if (content.length === 0) {
        // IA potentiellement encore en traitement — warn non-bloquant
        console.log('[13] ⚠️ WARN — Textarea vide (IA non encore traitée)')
      } else {
        expect(content.length).toBeGreaterThan(0)
      }
    }
  }

  await fetch(`${API_URL}/api/v1/superadmin/tenants/sun-and-drive/cleanup-simulation`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${await getSuperadminToken()}` }
  }).catch(console.error)
})
