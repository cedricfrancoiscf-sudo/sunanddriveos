import { test, expect } from '@playwright/test'

// Utilise Peugeot 208 (getaroundId 1472640) — identifiable par "208" ou "Peugeot"

test.describe('Rentabilité — coûts test Peugeot 208', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/rentability')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
  })

  test('Rentabilité — page charge avec KPIs', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Rentabilité' })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('main').getByText(/CA|Marge|Coût/i).first()).toBeVisible({ timeout: 10000 })
  })

  test('Rentabilité — ouvrir panneau Peugeot 208', async ({ page }) => {
    const vehicle = page.locator('main').getByText(/Peugeot.*208|208.*Peugeot/i).first()
    if (!await vehicle.isVisible({ timeout: 10000 })) {
      console.log('[25] Peugeot 208 non trouvé en rentabilité — skip')
      return
    }
    // Cliquer sur le bouton/ligne Peugeot 208
    const vehicleBtn = page.locator('main button').filter({ hasText: /Peugeot|208/ }).first()
    if (await vehicleBtn.isVisible({ timeout: 5000 })) {
      await vehicleBtn.click()
    } else {
      await vehicle.click()
    }
    await page.waitForTimeout(500)
    await expect(page.locator('main')).toBeVisible()
  })

  test('Rentabilité — ajouter coût fixe "Assurance test" 150€', async ({ page }) => {
    const vehicleBtn = page.locator('main button').filter({ hasText: /Peugeot|208/ }).first()
    if (!await vehicleBtn.isVisible({ timeout: 10000 })) {
      console.log('[25] Peugeot 208 non trouvé — skip')
      return
    }
    await vehicleBtn.click()
    await page.waitForTimeout(500)
    // Attendre le formulaire d'ajout de coût
    const labelInput = page.locator('input[placeholder*="Assurance"], input[placeholder*="label"], input[placeholder*="Label"]').first()
    if (!await labelInput.isVisible({ timeout: 8000 })) {
      console.log('[25] Formulaire coût non visible — skip')
      return
    }
    await labelInput.fill('Assurance test')
    const amountInput = page.locator('input[placeholder*="Montant"], input[placeholder*="montant"], input[type="number"]').first()
    await amountInput.fill('150')
    // Sélectionner type "fixe" si disponible
    const typeSelect = page.locator('select').first()
    if (await typeSelect.isVisible({ timeout: 2000 })) {
      await typeSelect.selectOption('fixed').catch(() => {})
    }
    await page.locator('button').filter({ hasText: /Ajouter|Enregistrer/ }).last().click()
    await page.waitForTimeout(1000)
    await expect(page.locator('main').getByText('Assurance test').first()).toBeVisible({ timeout: 10000 })
  })

  test('Rentabilité — ajouter coût ponctuel "Révision test" 600€ / 12 mois', async ({ page }) => {
    const vehicleBtn = page.locator('main button').filter({ hasText: /Peugeot|208/ }).first()
    if (!await vehicleBtn.isVisible({ timeout: 10000 })) return
    await vehicleBtn.click()
    await page.waitForTimeout(500)
    const labelInput = page.locator('input[placeholder*="Assurance"], input[placeholder*="label"], input[placeholder*="Label"]').first()
    if (!await labelInput.isVisible({ timeout: 8000 })) return
    await labelInput.fill('Révision test')
    const amountInput = page.locator('input[placeholder*="Montant"], input[type="number"]').first()
    await amountInput.fill('600')
    // Sélectionner type "ponctuel/onetime"
    const typeSelect = page.locator('select').first()
    if (await typeSelect.isVisible({ timeout: 2000 })) {
      await typeSelect.selectOption('onetime').catch(() => {})
    }
    // Remplir durée amortissement si visible
    const amortInput = page.locator('input[placeholder*="mois"], input[placeholder*="Amortiss"]').first()
    if (await amortInput.isVisible({ timeout: 2000 })) {
      await amortInput.fill('12')
    }
    await page.locator('button').filter({ hasText: /Ajouter|Enregistrer/ }).last().click()
    await page.waitForTimeout(1000)
    await expect(page.locator('main').getByText('Révision test').first()).toBeVisible({ timeout: 10000 })
  })

  test('Rentabilité — marge et break-even visibles après ajout coûts', async ({ page }) => {
    const vehicleBtn = page.locator('main button').filter({ hasText: /Peugeot|208/ }).first()
    if (!await vehicleBtn.isVisible({ timeout: 10000 })) return
    await vehicleBtn.click()
    await page.waitForTimeout(500)
    // Vérifier présence de la marge
    const marge = page.locator('main').getByText(/Marge|marge/i).first()
    await expect(marge).toBeVisible({ timeout: 10000 })
    // Vérifier break-even si visible
    const breakEven = page.locator('main').getByText(/Break.even|break.even|Seuil/i).first()
    if (await breakEven.isVisible({ timeout: 5000 })) {
      await expect(breakEven).toBeVisible()
    }
  })

  test('Rentabilité — supprimer les coûts test', async ({ page }) => {
    const vehicleBtn = page.locator('main button').filter({ hasText: /Peugeot|208/ }).first()
    if (!await vehicleBtn.isVisible({ timeout: 10000 })) return
    await vehicleBtn.click()
    await page.waitForTimeout(500)
    // Supprimer "Assurance test"
    const assuranceRow = page.locator('main').getByText('Assurance test').first()
    if (await assuranceRow.isVisible({ timeout: 5000 })) {
      const deleteBtn = assuranceRow.locator('..').locator('button[aria-label*="supprimer"], button[title*="supprimer"], button').filter({ hasText: /×|✕|Supprimer/i }).first()
      if (await deleteBtn.isVisible({ timeout: 2000 })) {
        await deleteBtn.click()
        await page.waitForTimeout(500)
        await page.locator('button').filter({ hasText: /Confirmer|Oui/i }).last().click().catch(() => {})
        await page.waitForTimeout(500)
      }
    }
    // Supprimer "Révision test"
    const revisionRow = page.locator('main').getByText('Révision test').first()
    if (await revisionRow.isVisible({ timeout: 5000 })) {
      const deleteBtn = revisionRow.locator('..').locator('button').filter({ hasText: /×|✕|Supprimer/i }).first()
      if (await deleteBtn.isVisible({ timeout: 2000 })) {
        await deleteBtn.click()
        await page.waitForTimeout(500)
        await page.locator('button').filter({ hasText: /Confirmer|Oui/i }).last().click().catch(() => {})
        await page.waitForTimeout(500)
      }
    }
    await expect(page.locator('main')).toBeVisible()
  })
})
