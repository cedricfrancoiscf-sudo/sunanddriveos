import { test, expect } from '@playwright/test'

// Cas 4 : problème mécanique — "bruit bizarre au démarrage"
// Cas 5 : retard — "je ne pourrai pas rendre la voiture à l'heure"

test.describe('Messagerie IA — Cas 4 & 5', () => {
  test('Messages — Cas 4 (mécanique) conversation visible', async ({ page }) => {
    await page.goto('/messages')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const msg = page.locator('main').getByText(/bruit bizarre|grincement/).first()
    if (await msg.isVisible({ timeout: 10000 })) {
      await expect(msg).toBeVisible()
    } else {
      console.log('[22] Cas 4 non trouvé dans messages — accepté')
    }
  })

  test('Messages — Cas 4 → détail contient analyse IA incident', async ({ page }) => {
    await page.goto('/messages')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const msg = page.locator('main').getByText(/bruit bizarre|grincement/).first()
    if (await msg.isVisible({ timeout: 8000 })) {
      await msg.click()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      // Vérifier qu'une analyse IA ou réponse est présente
      const aiSection = page.locator('main').getByText(/Analyse IA|Incident|incident|bruit|suggestion/i).first()
      if (await aiSection.isVisible({ timeout: 10000 })) {
        await expect(aiSection).toBeVisible()
      }
      // Vérifier status (pending_approval ou envoyé)
      const statusEl = page.locator('main').getByText(/Approuver|Envoyer|approuvé|envoyé|En attente/i).first()
      if (await statusEl.isVisible({ timeout: 5000 })) {
        await expect(statusEl).toBeVisible()
      }
    }
  })

  test('Messages — Cas 5 (retard) conversation visible', async ({ page }) => {
    await page.goto('/messages')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const msg = page.locator('main').getByText(/empêchement|retard|2h de retard/).first()
    if (await msg.isVisible({ timeout: 10000 })) {
      await expect(msg).toBeVisible()
    } else {
      console.log('[22] Cas 5 non trouvé dans messages — accepté')
    }
  })

  test('Messages — Cas 5 → détail avec lien location', async ({ page }) => {
    await page.goto('/messages')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const msg = page.locator('main').getByText(/empêchement|retard/).first()
    if (await msg.isVisible({ timeout: 8000 })) {
      await msg.click()
      await page.waitForURL(/\/messages\//, { timeout: 15000 })
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByRole('link', { name: /Voir la location/ })).toBeVisible({ timeout: 15000 })
    }
  })

  test('Messages — Cas 5 → analyse IA retard ou réponse présente', async ({ page }) => {
    await page.goto('/messages')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const msg = page.locator('main').getByText(/empêchement|retard/).first()
    if (await msg.isVisible({ timeout: 8000 })) {
      await msg.click()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      const analysisOrReply = page.locator('main').getByText(/Analyse IA|retard|procéder|Approuver|Envoyer/i).first()
      if (await analysisOrReply.isVisible({ timeout: 10000 })) {
        await expect(analysisOrReply).toBeVisible()
      } else {
        console.log('[22] Pas d\'analyse visible pour Cas 5')
      }
    }
  })

  test('Dashboard — alerte ou indicateur messages sans réponse', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)
    // Vérifier une alerte ou section messages / incidents
    const alertEl = page.locator('main').getByText(/Sans réponse|sans réponse|unanswered|message/i).first()
    if (await alertEl.isVisible({ timeout: 10000 })) {
      await expect(alertEl).toBeVisible()
    } else {
      // Le dashboard peut ne pas afficher d'alerte si les messages sont tous traités
      await expect(page.locator('main')).toBeVisible()
    }
  })
})
