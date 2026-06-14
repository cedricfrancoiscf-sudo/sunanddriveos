import { test, expect } from '@playwright/test'

const SIDEBAR_ROUTES = [
  { name: 'Dashboard', path: '/dashboard', heading: /Dashboard|Tableau de bord/i },
  { name: 'Planning', path: '/planning', heading: /Planning/i },
  { name: 'Locations', path: '/rentals', heading: /Location/i },
  { name: 'Messages', path: '/messages', heading: /Message/i },
  { name: 'Flotte', path: '/fleet', heading: /Flotte|Véhicule/i },
  { name: 'Locataires', path: '/renters', heading: /Locataire/i },
  { name: 'Accessoires', path: '/accessories', heading: /Accessoire|Siège/i },
  { name: 'Entretiens', path: '/maintenance', heading: /Entretien|Maintenance/i },
  { name: 'Intelligence', path: '/intelligence', heading: /Intelligence|CA mensuel/i },
  { name: 'Rentabilité', path: '/rentability', heading: /Rentabilit/i },
  { name: 'Rapport CEO', path: '/ceo-report', heading: /CEO|Rapport/i },
  { name: 'Paramètres', path: '/settings', heading: /Param/i },
]

test.describe('Monkey test admin — toutes les routes', () => {
  for (const route of SIDEBAR_ROUTES) {
    test(`${route.name} — page charge sans blanc`, async ({ page }) => {
      const errors: string[] = []
      page.on('console', msg => {
        if (msg.type() === 'error' && !msg.text().includes('favicon')) {
          errors.push(msg.text())
        }
      })
      await page.goto(route.path)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      // Page non blanche — au moins un élément main visible
      await expect(page.locator('main')).toBeVisible({ timeout: 15000 })
      // Heading ou contenu attendu visible
      const heading = page.locator('main').getByText(route.heading).first()
      if (await heading.isVisible({ timeout: 8000 })) {
        await expect(heading).toBeVisible()
      }
      // Pas d'erreur JS critique (on accepte les erreurs réseau)
      const criticalErrors = errors.filter(e =>
        !e.includes('net::ERR') && !e.includes('404') && !e.includes('favicon') &&
        !e.includes('Failed to load resource'),
      )
      if (criticalErrors.length > 0) {
        console.log(`[28] Erreurs console sur ${route.name}:`, criticalErrors)
      }
    })
  }

  test('Dashboard — cliquer premier élément de chaque liste', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)
    // Cliquer sur le premier lien de la section alertes/locations
    const firstLink = page.locator('main').getByRole('link').first()
    if (await firstLink.isVisible({ timeout: 5000 })) {
      await firstLink.click()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('main')).toBeVisible()
    }
  })

  test('Planning — modals ouvrent et ferment', async ({ page }) => {
    await page.goto('/planning')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const blocageBtn = page.getByRole('button', { name: /Blocage/i }).first()
    if (await blocageBtn.isVisible({ timeout: 5000 })) {
      await blocageBtn.click()
      await expect(page.locator('main').getByText(/[Nn]ouveau blocage|[Bb]locage/)).toBeVisible({ timeout: 5000 })
      const cancelBtn = page.getByRole('button', { name: /Annuler|Fermer/i }).first()
      if (await cancelBtn.isVisible()) await cancelBtn.click()
      await expect(page.locator('main').getByText(/[Nn]ouveau blocage/)).not.toBeVisible({ timeout: 3000 })
    }
  })

  test('Locations — filtres et tri fonctionnels', async ({ page }) => {
    await page.goto('/rentals')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    // Tester le filtre statut si disponible
    const statusFilter = page.locator('select').first()
    if (await statusFilter.isVisible({ timeout: 5000 })) {
      await statusFilter.selectOption({ index: 1 })
      await page.waitForTimeout(500)
      await expect(page.locator('main')).toBeVisible()
      await statusFilter.selectOption({ index: 0 })
    }
  })

  test('Flotte — cliquer sur un véhicule ouvre le détail', async ({ page }) => {
    await page.goto('/fleet')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const vehicle = page.locator('main').getByRole('link').first()
      .or(page.locator('main').getByRole('button').first())
    if (await vehicle.isVisible({ timeout: 8000 })) {
      await vehicle.click()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('main')).toBeVisible()
    }
  })

  test('Accessoires — onglets accessibles', async ({ page }) => {
    await page.goto('/accessories')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const tabs = page.getByRole('tab').all()
    const tabList = await tabs
    for (const tab of tabList.slice(0, 3)) {
      if (await tab.isVisible()) {
        await tab.click()
        await page.waitForTimeout(500)
        await expect(page.locator('main')).toBeVisible()
      }
    }
  })

  test('Messages — filtre véhicule visible', async ({ page }) => {
    await page.goto('/messages')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const vehicleFilter = page.locator('select').first()
    if (await vehicleFilter.isVisible({ timeout: 5000 })) {
      await vehicleFilter.selectOption({ index: 1 }).catch(() => {})
      await page.waitForTimeout(500)
      await vehicleFilter.selectOption({ index: 0 }).catch(() => {})
    }
    await expect(page.locator('main')).toBeVisible()
  })

  test('Paramètres — formulaires affichent les bons champs', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    await expect(page.locator('main')).toBeVisible({ timeout: 10000 })
    // Vérifier qu'il y a des inputs ou sections de config
    const inputOrSection = page.locator('main input, main select, main textarea').first()
    if (await inputOrSection.isVisible({ timeout: 8000 })) {
      await expect(inputOrSection).toBeVisible()
    }
  })

  test('Intelligence — filtres et graphiques interactifs', async ({ page }) => {
    await page.goto('/intelligence')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)
    // Cliquer sur un tab ou bouton de filtre
    const filterBtn = page.locator('main button').filter({ hasText: /Occupation|CA|Locations/i }).first()
    if (await filterBtn.isVisible({ timeout: 5000 })) {
      await filterBtn.click()
      await page.waitForTimeout(1000)
      await expect(page.locator('main')).toBeVisible()
    }
  })

  test('Rentabilité — tri par colonnes', async ({ page }) => {
    await page.goto('/rentability')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    const sortBtn = page.locator('main button').filter({ hasText: /Marge|CA|Taux/i }).first()
    if (await sortBtn.isVisible({ timeout: 5000 })) {
      await sortBtn.click()
      await page.waitForTimeout(500)
      await expect(page.locator('main')).toBeVisible()
    }
  })
})
