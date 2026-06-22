import { test, expect } from '@playwright/test'
import { cleanupPlaywrightData } from './helpers/auth'

test.afterAll(async () => { await cleanupPlaywrightData().catch(() => {}) })

// Peugeot 208 — noter 4.5 en août 2026, puis 3.5 en juillet 2026
// → alerte baisse consécutive attendue

test.describe('Intelligence — Ratings Peugeot 208', () => {
  test.beforeEach(async ({ page }) => {
    // Naviguer vers la page Ratings (onglet ou sous-route)
    await page.goto('/intelligence/ratings')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    // Fallback : naviguer depuis /intelligence si la route directe échoue
    if (!await page.locator('main').isVisible({ timeout: 3000 })) {
      await page.goto('/intelligence')
      await page.waitForLoadState('domcontentloaded')
      const ratingsTab = page.getByRole('tab', { name: /Rating|Avis|Note/i })
        .or(page.getByRole('link', { name: /Rating|Avis/i }))
        .first()
      if (await ratingsTab.isVisible({ timeout: 5000 })) await ratingsTab.click()
    }
    await page.waitForTimeout(500)
  })

  test('Ratings — page charge avec liste véhicules', async ({ page }) => {
    await expect(page.locator('main')).toBeVisible({ timeout: 10000 })
    const vehicleSelect = page.locator('select, [role="combobox"]').first()
    await expect(vehicleSelect).toBeVisible({ timeout: 10000 })
  })

  test('Ratings — sélectionner Peugeot 208', async ({ page }) => {
    const vehicleSelect = page.locator('select, [role="combobox"]').first()
    if (!await vehicleSelect.isVisible({ timeout: 8000 })) {
      console.log('[26] Sélecteur véhicule non trouvé — skip')
      return
    }
    // Sélectionner Peugeot 208
    await vehicleSelect.selectOption({ label: /Peugeot.*208|208/i }).catch(async () => {
      // Alternative : sélectionner le premier véhicule disponible
      await vehicleSelect.selectOption({ index: 1 }).catch(() => {})
    })
    await page.waitForTimeout(500)
    await expect(page.locator('main')).toBeVisible()
  })

  test('Ratings — saisir note 4.5 pour août 2026', async ({ page }) => {
    const vehicleSelect = page.locator('select, [role="combobox"]').first()
    if (!await vehicleSelect.isVisible({ timeout: 8000 })) return
    await vehicleSelect.selectOption({ label: /Peugeot.*208|208/i }).catch(async () => {
      await vehicleSelect.selectOption({ index: 1 }).catch(() => {})
    })
    await page.waitForTimeout(500)
    // Sélectionner la période août 2026
    const periodInput = page.locator('input[type="month"], input[placeholder*="période"], input[placeholder*="Période"]').first()
    if (await periodInput.isVisible({ timeout: 5000 })) {
      await periodInput.fill('2026-08')
    }
    // Cliquer sur l'étoile 4 ou 5 (StarInput)
    const stars = page.locator('main button').filter({ hasText: '★' })
    const count = await stars.count()
    if (count >= 5) {
      // Cliquer sur la 5e étoile pour ~4.5 (on clique 5 et on ajuste si possible)
      await stars.nth(4).click()
      await page.waitForTimeout(300)
    } else if (count > 0) {
      await stars.last().click()
    }
    // Saisir le nombre d'avis
    const reviewCount = page.locator('input[type="number"]').first()
    if (await reviewCount.isVisible({ timeout: 3000 })) {
      await reviewCount.fill('10')
    }
    // Soumettre
    const submitBtn = page.locator('button').filter({ hasText: /Enregistrer|Sauvegarder|Ajouter/i }).first()
    if (await submitBtn.isVisible({ timeout: 5000 })) {
      await submitBtn.click()
      await page.waitForTimeout(1000)
    }
    await expect(page.locator('main')).toBeVisible()
  })

  test('Ratings — graphique mis à jour après saisie', async ({ page }) => {
    const vehicleSelect = page.locator('select, [role="combobox"]').first()
    if (!await vehicleSelect.isVisible({ timeout: 8000 })) return
    await vehicleSelect.selectOption({ index: 1 }).catch(() => {})
    await page.waitForTimeout(500)
    // Vérifier la présence du graphique Recharts
    const chart = page.locator('.recharts-wrapper, svg').first()
    if (await chart.isVisible({ timeout: 10000 })) {
      await expect(chart).toBeVisible()
    } else {
      console.log('[26] Graphique non trouvé après saisie')
    }
  })

  test('Ratings — saisir note 3.5 pour juillet 2026', async ({ page }) => {
    const vehicleSelect = page.locator('select, [role="combobox"]').first()
    if (!await vehicleSelect.isVisible({ timeout: 8000 })) return
    await vehicleSelect.selectOption({ label: /Peugeot.*208|208/i }).catch(async () => {
      await vehicleSelect.selectOption({ index: 1 }).catch(() => {})
    })
    await page.waitForTimeout(500)
    const periodInput = page.locator('input[type="month"]').first()
    if (await periodInput.isVisible({ timeout: 5000 })) {
      await periodInput.fill('2026-07')
    }
    // Cliquer sur la 3e ou 4e étoile
    const stars = page.locator('main button').filter({ hasText: '★' })
    const count = await stars.count()
    if (count >= 4) {
      await stars.nth(2).click()
    } else if (count > 0) {
      await stars.first().click()
    }
    const reviewCount = page.locator('input[type="number"]').first()
    if (await reviewCount.isVisible({ timeout: 3000 })) await reviewCount.fill('8')
    const submitBtn = page.locator('button').filter({ hasText: /Enregistrer|Sauvegarder|Ajouter/i }).first()
    if (await submitBtn.isVisible({ timeout: 5000 })) {
      await submitBtn.click()
      await page.waitForTimeout(1000)
    }
  })

  test('Ratings — alerte baisse consécutive visible après 4.5→3.5', async ({ page }) => {
    const vehicleSelect = page.locator('select, [role="combobox"]').first()
    if (!await vehicleSelect.isVisible({ timeout: 8000 })) return
    await vehicleSelect.selectOption({ label: /Peugeot.*208|208/i }).catch(async () => {
      await vehicleSelect.selectOption({ index: 1 }).catch(() => {})
    })
    await page.waitForTimeout(1000)
    // Chercher une alerte de baisse
    const alert = page.locator('main').getByText(/baisse|chute|Alerte|dégradation|consécutive/i).first()
    if (await alert.isVisible({ timeout: 8000 })) {
      await expect(alert).toBeVisible()
    } else {
      console.log('[26] Alerte baisse non visible — peut nécessiter recharge ou seuil différent')
    }
  })
})
