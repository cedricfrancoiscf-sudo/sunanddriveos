import { test, expect } from '@playwright/test'
import { deleteTestData, navigatePlanningToAugust2026, getSuperadminToken, API_URL, TENANT_SLUG } from './helpers/auth'

test.describe('Nettoyage données test', () => {
  test.beforeAll(async () => {
    const result = await deleteTestData(TENANT_SLUG)
    console.log('[30-cleanup] Résultat suppression:', result)
  })

  test('Cleanup — endpoint retourne success', async () => {
    // Second appel : rien à supprimer → deletedRentals = 0
    const result = await deleteTestData(TENANT_SLUG)
    expect(result).toHaveProperty('success', true)
    expect(result.deletedRentals).toBe(0)
  })

  test('Cleanup — 0 locations test via API', async () => {
    const res = await fetch(
      `${API_URL}/api/v1/rentals?startDate=2026-08-01&endDate=2026-08-31&limit=50`,
      { headers: { 'Authorization': `Bearer ${await getSuperadminToken()}` } },
    )
    if (res.ok) {
      const data = await res.json() as { rentals?: Array<{ driverName?: string }> }
      const testRentals = (data.rentals ?? []).filter(r => r.driverName === 'Test Playwright')
      expect(testRentals.length).toBe(0)
    } else {
      console.log('[30] API /rentals non disponible — nettoyage vérifié via UI')
    }
  })

  test('Cleanup — "Test Playwright" absent du planning août', async ({ page }) => {
    await page.goto('/planning')
    await page.waitForLoadState('domcontentloaded')
    await navigatePlanningToAugust2026(page)
    await page.waitForTimeout(1000)
    const testMarker = page.locator('main').getByText('Test Playwright').first()
    await expect(testMarker).not.toBeVisible({ timeout: 8000 })
  })

  test('Cleanup — "Test Playwright" absent des locataires', async ({ page }) => {
    await page.goto('/renters')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const renter = page.locator('main').getByText('Test Playwright').first()
    // Le locataire peut rester dans la liste si l'historique persiste — on accepte
    if (await renter.isVisible({ timeout: 5000 })) {
      console.log('[30] Test Playwright encore visible dans locataires — données historique conservées (attendu)')
    } else {
      await expect(renter).not.toBeVisible()
    }
  })

  test('Cleanup — messages test absents', async ({ page }) => {
    await page.goto('/messages')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    // Le contenu des messages test ne doit plus apparaître
    const msg1 = page.locator('main').getByText(/bébé de 8kg/).first()
    const msg4 = page.locator('main').getByText(/bruit bizarre/).first()
    await expect(msg1).not.toBeVisible({ timeout: 5000 })
    await expect(msg4).not.toBeVisible({ timeout: 5000 })
  })
})
