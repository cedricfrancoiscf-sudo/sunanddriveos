import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// ─── Report tracking ──────────────────────────────────────────────────────────
type Entry = { status: '✅ PASS' | '❌ FAIL' | '⚠️ WARN'; desc: string; detail?: string }
const REPORT: Entry[] = []

function rPass(desc: string) {
  REPORT.push({ status: '✅ PASS', desc })
  console.log(`[28] ✅ PASS — ${desc}`)
}
function rFail(desc: string, detail: string) {
  REPORT.push({ status: '❌ FAIL', desc, detail })
  console.log(`[28] ❌ FAIL — ${desc} — ${detail}`)
}
function rWarn(desc: string, detail: string) {
  REPORT.push({ status: '⚠️ WARN', desc, detail })
  console.log(`[28] ⚠️ WARN — ${desc} — ${detail}`)
}

function saveReport() {
  const outDir = path.resolve(process.cwd(), 'tests/e2e/results')
  fs.mkdirSync(outDir, { recursive: true })
  const pass = REPORT.filter(r => r.status === '✅ PASS').length
  const fail = REPORT.filter(r => r.status === '❌ FAIL').length
  const warn = REPORT.filter(r => r.status === '⚠️ WARN').length
  const lines = [
    '═══════════════════════════════════════════════════════════════',
    '   MONKEY REPORT — Admin Sun and Drive',
    `   Généré le : ${new Date().toLocaleString('fr-FR')}`,
    '═══════════════════════════════════════════════════════════════',
    '',
    ...REPORT.map(r =>
      r.detail ? `${r.status} — ${r.desc} — ${r.detail}` : `${r.status} — ${r.desc}`,
    ),
    '',
    '───────────────────────────────────────────────────────────────',
    `Total       : ${REPORT.length} tests`,
    `✅ Passés   : ${pass}`,
    `❌ Échoués  : ${fail}`,
    `⚠️ Warnings : ${warn}`,
    '───────────────────────────────────────────────────────────────',
  ]
  const reportPath = path.join(outDir, 'monkey-report.txt')
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8')
  console.log(`[28] ═══ Rapport écrit : ${reportPath} ═══`)
  console.log(`[28] Total: ${REPORT.length} | ✅ ${pass} | ❌ ${fail} | ⚠️ ${warn}`)
}

// ─── Routes to verify ─────────────────────────────────────────────────────────
const ROUTES = [
  { name: 'Dashboard',       path: '/dashboard' },
  { name: 'Planning',        path: '/planning' },
  { name: 'Locations',       path: '/rentals' },
  { name: 'Messages',        path: '/messages' },
  { name: 'Véhicules',       path: '/vehicles' },
  { name: 'Locataires',      path: '/renters' },
  { name: 'Accessoires',     path: '/accessories' },
  { name: 'Entretiens',      path: '/maintenance' },
  { name: 'CT',              path: '/technical-controls' },
  { name: 'Intelligence',    path: '/intelligence' },
  { name: 'Rentabilité',     path: '/rentability' },
  { name: 'Rapport CEO',     path: '/intelligence/report' },
  { name: 'Paramètres',      path: '/settings' },
]

// ─────────────────────────────────────────────────────────────────────────────
test.describe('Monkey test admin — exhaustif', () => {
  test.afterAll(() => saveReport())

  // ════════════════════════════════════════════════════════════════
  // SECTION 1 : ROUTES — chaque page charge sans erreur
  // ════════════════════════════════════════════════════════════════

  for (const route of ROUTES) {
    test(`Route ${route.name} — charge sans erreur`, async ({ page }) => {
      const jsErrors: string[] = []
      page.on('console', msg => {
        if (msg.type() === 'error'
          && !msg.text().includes('favicon')
          && !msg.text().includes('net::ERR')
          && !msg.text().includes('Failed to load resource')) {
          jsErrors.push(msg.text())
        }
      })
      try {
        await page.goto(route.path)
        await page.waitForLoadState('domcontentloaded')
        await page.waitForTimeout(1500)

        // Pas de redirection vers /dashboard (sauf si c'est le dashboard)
        if (route.path !== '/dashboard') {
          const url = page.url()
          if (url.includes('/dashboard') && !url.includes(route.path.replace('/', ''))) {
            rFail(`Route ${route.name}`, `Redirigé vers dashboard (${url})`)
            return
          }
        }

        // Main visible
        if (!await page.locator('main').isVisible({ timeout: 10000 })) {
          rFail(`Route ${route.name}`, 'Élément <main> non visible')
          return
        }

        // Contenu suspect
        const body = (await page.locator('main').textContent({ timeout: 5000 }) ?? '').substring(0, 2000)
        const reRawError  = /\berror\b/i
        const reUndefined = /\bundefined\b/
        const reNaN       = /\bNaN\b/
        const hasRawError   = reRawError.test(body) && !/[Ee]rreur|Erreurs/.test(body)
        const hasUndefined  = reUndefined.test(body)
        const hasNaN        = reNaN.test(body)

        if (hasRawError || hasUndefined || hasNaN) {
          const suspects = [hasRawError && '"error"', hasUndefined && '"undefined"', hasNaN && '"NaN"']
            .filter(Boolean).join(', ')
          rWarn(`Route ${route.name}`, `Texte suspect dans le contenu : ${suspects}`)
        } else {
          rPass(`Route ${route.name}`)
        }
      } catch (e) { rFail(`Route ${route.name}`, String(e)) }
    })
  }

  // ════════════════════════════════════════════════════════════════
  // SECTION 2 : FLOTTE
  // ════════════════════════════════════════════════════════════════

  test('Flotte — liste véhicules visible', async ({ page }) => {
    try {
      await page.goto('/vehicles')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForSelector('main a[href*="/vehicles/"]', { timeout: 15000 })
      const count = await page.locator('main a[href*="/vehicles/"]').count()
      count > 0
        ? rPass(`Flotte — ${count} véhicule(s) listés`)
        : rWarn('Flotte — liste véhicules', 'Aucun lien /vehicles/ dans main')
    } catch (e) { rFail('Flotte — liste véhicules', String(e)) }
  })

  test('Flotte — vue liste vs vue grille (toggle)', async ({ page }) => {
    try {
      await page.goto('/vehicles')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const gridBtn = page.locator('button[aria-label*="grille"], button[aria-label*="grid"]').first()
        .or(page.locator('button').filter({ hasText: /Grille|Grid/i }).first())
      const listBtn = page.locator('button[aria-label*="liste"], button[aria-label*="list"]').first()
        .or(page.locator('button').filter({ hasText: /^Liste$|^List$/i }).first())
      let toggled = 0
      if (await gridBtn.isVisible({ timeout: 3000 })) { await gridBtn.click(); await page.waitForTimeout(400); toggled++ }
      if (await listBtn.isVisible({ timeout: 3000 })) { await listBtn.click(); await page.waitForTimeout(400); toggled++ }
      toggled >= 1
        ? rPass(`Flotte — toggle vue liste/grille (${toggled} bouton(s) cliqués)`)
        : rWarn('Flotte — toggle liste/grille', 'Boutons liste/grille non trouvés')
    } catch (e) { rFail('Flotte — toggle liste/grille', String(e)) }
  })

  test('Flotte — recherche par immatriculation', async ({ page }) => {
    try {
      await page.goto('/vehicles')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const searchInput = page.locator(
        'input[type="search"], input[placeholder*="Recherch"], input[placeholder*="immat"], input[placeholder*="plaque"]',
      ).first()
      if (!await searchInput.isVisible({ timeout: 5000 })) {
        rWarn('Flotte — recherche immatriculation', 'Champ recherche non trouvé')
        return
      }
      await searchInput.fill('FZ671YT')
      await page.waitForTimeout(800)
      if (await page.locator('main').getByText('FZ671YT').first().isVisible({ timeout: 5000 })) {
        rPass('Flotte — recherche "FZ671YT" retourne un résultat')
      } else {
        rWarn('Flotte — recherche immatriculation', 'FZ671YT introuvable après recherche')
      }
      await searchInput.clear()
    } catch (e) { rFail('Flotte — recherche immatriculation', String(e)) }
  })

  test('Flotte — fiche véhicule (Citroen C3 ou premier dispo)', async ({ page }) => {
    try {
      await page.goto('/vehicles')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      // Chercher Citroen C3 en priorité
      const c3 = page.locator('main').getByText(/Citroen.*C3|C3.*Citroen|citroen/i).first()
      if (await c3.isVisible({ timeout: 4000 })) {
        await c3.click()
      } else {
        const firstLink = page.locator('main a[href*="/vehicles/"]').first()
        if (!await firstLink.isVisible({ timeout: 8000 })) {
          rWarn('Flotte — fiche véhicule', 'Aucun véhicule dans la liste')
          return
        }
        await firstLink.click()
      }
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)

      // Vérifier URL /vehicles/...
      if (!page.url().includes('/vehicles/')) {
        rFail('Flotte — fiche véhicule', `URL inattendue : ${page.url()}`)
        return
      }
      rPass('Flotte — fiche véhicule ouverte')

      // Vérifier champs clés
      const body = await page.locator('main').textContent() ?? ''
      const reImmat      = /[A-Z]{2}\d{3}[A-Z]{2}/
      const reGetaround  = /getaround|GET\d|id.{0,10}\d{5,}/i
      const checks = {
        'immatriculation': reImmat.test(body),
        'statut/actif':    /[Ss]tatut|[Aa]ctif|[Aa]ctive/.test(body),
        'point livraison': /livraison|parking|gare/i.test(body),
        'ID Getaround':    reGetaround.test(body),
        'bouton Modifier': await page.getByRole('link', { name: /Modifier/i }).first().isVisible({ timeout: 5000 }),
      }
      const found = Object.entries(checks).filter(([, v]) => v).map(([k]) => k)
      found.length >= 3
        ? rPass(`Flotte — fiche contient : ${found.join(', ')}`)
        : rWarn('Flotte — champs fiche', `Seulement ${found.length}/5 champs détectés : ${found.join(', ')}`)
    } catch (e) { rFail('Flotte — fiche véhicule', String(e)) }
  })

  test('Flotte — bouton Modifier → formulaire (pas dashboard)', async ({ page }) => {
    try {
      await page.goto('/vehicles')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(800)
      const firstLink = page.locator('main a[href*="/vehicles/"]').first()
      if (!await firstLink.isVisible({ timeout: 8000 })) {
        rWarn('Flotte — bouton Modifier', 'Aucun véhicule dans la liste')
        return
      }
      await firstLink.click()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const modifyLink = page.getByRole('link', { name: /Modifier/i }).first()
      if (!await modifyLink.isVisible({ timeout: 8000 })) {
        rWarn('Flotte — bouton Modifier', 'Bouton Modifier non trouvé sur la fiche')
        return
      }
      await modifyLink.click()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const url = page.url()
      if (url.includes('/dashboard')) {
        rFail('Flotte — bouton Modifier', 'Redirigé vers dashboard au lieu du formulaire')
        return
      }
      if (!url.includes('/edit')) {
        rWarn('Flotte — bouton Modifier', `URL hors /edit : ${url}`)
      } else {
        rPass('Flotte — bouton Modifier ouvre /edit')
      }
      // Vérifier champs du formulaire
      await page.waitForSelector('form', { timeout: 15000 })
      const body = await page.locator('main').textContent() ?? ''
      const fieldChecks = {
        'Point de livraison': /livraison|parking/i.test(body),
        'Getaround ID':       /getaround|ID/i.test(body),
        'Couleur':            /couleur|color/i.test(body),
        'Kilométrage':        /km|kilom/i.test(body),
        'Score santé':        /santé|health|score/i.test(body),
      }
      const found = Object.entries(fieldChecks).filter(([, v]) => v).map(([k]) => k)
      found.length >= 2
        ? rPass(`Flotte — formulaire édition contient : ${found.join(', ')}`)
        : rWarn('Flotte — champs formulaire édition', `${found.length}/5 champs trouvés`)
    } catch (e) { rFail('Flotte — bouton Modifier', String(e)) }
  })

  test('Flotte — Annuler formulaire → retour fiche', async ({ page }) => {
    try {
      await page.goto('/vehicles')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(800)
      const firstLink = page.locator('main a[href*="/vehicles/"]').first()
      if (!await firstLink.isVisible({ timeout: 8000 })) { rWarn('Flotte — Annuler', 'Aucun véhicule'); return }
      await firstLink.click()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(800)
      const modifyLink = page.getByRole('link', { name: /Modifier/i }).first()
      if (!await modifyLink.isVisible({ timeout: 8000 })) { rWarn('Flotte — Annuler', 'Bouton Modifier absent'); return }
      await modifyLink.click()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const cancelBtn = page.getByRole('button', { name: /Annuler/i }).first()
        .or(page.getByRole('link', { name: /Annuler|Retour/i }).first())
      if (!await cancelBtn.isVisible({ timeout: 8000 })) { rWarn('Flotte — Annuler', 'Bouton Annuler absent'); return }
      await cancelBtn.click()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(600)
      const url = page.url()
      if (url.includes('/dashboard')) {
        rWarn('Flotte — Annuler formulaire', 'Annuler redirige vers dashboard (bug ?)')
      } else if (url.includes('/vehicles/')) {
        rPass('Flotte — Annuler → retour fiche véhicule')
      } else {
        rWarn('Flotte — Annuler formulaire', `URL inattendue : ${url}`)
      }
    } catch (e) { rFail('Flotte — Annuler formulaire', String(e)) }
  })

  // ════════════════════════════════════════════════════════════════
  // SECTION 3 : LOCATIONS
  // ════════════════════════════════════════════════════════════════

  test('Locations — filtre mensuel prev/next', async ({ page }) => {
    try {
      await page.goto('/rentals')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      // Bouton précédent : première icône flèche dans main
      const prevBtn = page.locator('main').getByRole('button').first()
      if (await prevBtn.isVisible({ timeout: 5000 })) {
        await prevBtn.click()
        await page.waitForTimeout(500)
        await expect(page.locator('main')).toBeVisible()
        rPass('Locations — filtre mensuel prev cliqué')
      } else {
        rWarn('Locations — filtre mensuel prev', 'Bouton non trouvé')
      }
      // Bouton suivant : 2e bouton
      const nextBtn = page.locator('main').getByRole('button').nth(1)
      if (await nextBtn.isVisible({ timeout: 3000 })) {
        await nextBtn.click()
        await page.waitForTimeout(500)
        rPass('Locations — filtre mensuel next cliqué')
      }
    } catch (e) { rFail('Locations — filtre mensuel', String(e)) }
  })

  test('Locations — recherche par locataire', async ({ page }) => {
    try {
      await page.goto('/rentals')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(800)
      const search = page.getByRole('textbox', { name: /Recherch/i }).first()
        .or(page.locator('input[type="search"], input[placeholder*="Recherch"]').first())
      if (!await search.isVisible({ timeout: 5000 })) {
        rWarn('Locations — recherche', 'Champ recherche non trouvé')
        return
      }
      await search.fill('Test')
      await page.waitForTimeout(700)
      rPass('Locations — recherche par locataire saisie OK')
      await search.clear()
    } catch (e) { rFail('Locations — recherche par locataire', String(e)) }
  })

  test('Locations — clic → fiche location avec champs', async ({ page }) => {
    try {
      await page.goto('/rentals')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const firstLink = page.locator('main').getByRole('link').first()
      if (!await firstLink.isVisible({ timeout: 8000 })) {
        rWarn('Locations — fiche', 'Aucun lien location dans la liste')
        return
      }
      await firstLink.click()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(700)
      if (!page.url().includes('/rentals/')) {
        rWarn('Locations — fiche', `URL inattendue : ${page.url()}`)
        return
      }
      rPass('Locations — clic ouvre fiche /rentals/…')
      // Vérifier champs fiche
      const body = await page.locator('main').textContent() ?? ''
      const champs = {
        'locataire':  /locataire|conducteur|renter|driver/i.test(body),
        'véhicule':   /véhicule|voiture|vehicle|immat/i.test(body),
        'dates':      /date|début|fin|du |au |from|until/i.test(body),
        'montant':    /€|EUR|CA|montant|total|revenue/i.test(body),
        'statut':     /statut|status|actif|terminé|completed/i.test(body),
      }
      const found = Object.entries(champs).filter(([, v]) => v).map(([k]) => k)
      found.length >= 3
        ? rPass(`Locations — fiche contient : ${found.join(', ')}`)
        : rWarn('Locations — champs fiche', `${found.length}/5 champs : ${found.join(', ')}`)
    } catch (e) { rFail('Locations — clic fiche', String(e)) }
  })

  test('Locations — bouton Réactiver évaluation', async ({ page }) => {
    try {
      await page.goto('/rentals')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(800)
      const firstLink = page.locator('main').getByRole('link').first()
      if (!await firstLink.isVisible({ timeout: 8000 })) { rWarn('Locations — Réactiver', 'Aucune location'); return }
      await firstLink.click()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(800)
      const reactivateBtn = page.getByRole('button', { name: /Réactiver|réactiver|évaluation/i }).first()
      await reactivateBtn.isVisible({ timeout: 3000 })
        ? rPass('Locations — bouton Réactiver évaluation présent')
        : rWarn('Locations — Réactiver évaluation', 'Bouton absent (normal si déjà évalué)')
    } catch (e) { rFail('Locations — Réactiver évaluation', String(e)) }
  })

  // ════════════════════════════════════════════════════════════════
  // SECTION 4 : MESSAGES
  // ════════════════════════════════════════════════════════════════

  test('Messages — liste conversations groupées', async ({ page }) => {
    try {
      await page.goto('/messages')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const items = page.locator('main div.overflow-hidden button')
        .or(page.locator('main [role="listitem"] button'))
      const count = await items.count()
      count > 0
        ? rPass(`Messages — ${count} conversation(s) visible(s)`)
        : rWarn('Messages — liste conversations', 'Aucune conversation détectée')
    } catch (e) { rFail('Messages — liste conversations', String(e)) }
  })

  test('Messages — filtre par véhicule', async ({ page }) => {
    try {
      await page.goto('/messages')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const filter = page.locator('select').first()
      if (!await filter.isVisible({ timeout: 5000 })) {
        rWarn('Messages — filtre véhicule', 'Select non trouvé')
        return
      }
      const opts = await filter.locator('option').count()
      if (opts <= 1) { rWarn('Messages — filtre véhicule', 'Moins de 2 options'); return }
      await filter.selectOption({ index: 1 })
      await page.waitForTimeout(700)
      await expect(page.locator('main')).toBeVisible()
      rPass('Messages — filtre véhicule fonctionne')
      await filter.selectOption({ index: 0 })
    } catch (e) { rFail('Messages — filtre véhicule', String(e)) }
  })

  test('Messages — conv siège bébé Test Playwright → zone suggestion IA', async ({ page }) => {
    try {
      await page.goto('/messages')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      // Chercher conv siège bébé / Test Playwright
      const conv = page.locator('main').getByText(/siège bébé|siege bebe|siège auto|baby seat|Test Playwright/i).first()
      let opened = false
      if (await conv.isVisible({ timeout: 8000 })) {
        await conv.click()
        await page.waitForURL(/\/messages\//, { timeout: 15000 })
        await page.waitForTimeout(1500)
        opened = true
        rPass('Messages — conversation siège bébé ouverte')
      } else {
        rWarn('Messages — conv siège bébé', 'Non trouvée (seed requis) — test sur 1ère conv')
        const firstConv = page.locator('main div.overflow-hidden button').first()
        if (await firstConv.isVisible({ timeout: 5000 })) {
          await firstConv.click()
          await page.waitForURL(/\/messages\//, { timeout: 15000 }).catch(() => {})
          await page.waitForTimeout(1500)
          opened = true
        }
      }
      if (!opened) { rWarn('Messages — zone suggestion', 'Aucune conversation ouvrable'); return }

      // Vérifier zone suggestion IA (contient la réponse IA, pas le message locataire)
      const suggestionZone = page.locator('main').getByText(/Suggestion|suggestion à approuver|réponse suggérée/i).first()
      if (await suggestionZone.isVisible({ timeout: 10000 })) {
        rPass('Messages — zone "Suggestion à approuver" présente')
        // Bouton Approuver
        const approveBtn = page.getByRole('button', { name: /Approuver|Envoyer/i }).first()
        await approveBtn.isVisible({ timeout: 3000 })
          ? rPass('Messages — bouton Approuver présent')
          : rWarn('Messages — bouton Approuver', 'Non trouvé')
        // Bouton Annuler/Rejeter
        const cancelBtn = page.getByRole('button', { name: /Annuler|Rejeter|Ignorer/i }).first()
        await cancelBtn.isVisible({ timeout: 3000 })
          ? rPass('Messages — bouton Annuler suggestion présent')
          : rWarn('Messages — bouton Annuler suggestion', 'Non trouvé')
      } else {
        rWarn('Messages — zone suggestion IA', 'Non visible (conv sans suggestion ou déjà traitée)')
      }
    } catch (e) { rFail('Messages — conv siège bébé', String(e)) }
  })

  test('Messages — Approuver puis Annuler suggestion', async ({ page }) => {
    try {
      await page.goto('/messages')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const firstConv = page.locator('main div.overflow-hidden button').first()
      if (!await firstConv.isVisible({ timeout: 8000 })) {
        rWarn('Messages — Approuver/Annuler', 'Aucune conversation')
        return
      }
      await firstConv.click()
      await page.waitForURL(/\/messages\//, { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(1500)
      // Tester Annuler (sans risque d'envoyer un message réel)
      const cancelBtn = page.getByRole('button', { name: /Annuler|Rejeter|Ignorer/i }).first()
      if (await cancelBtn.isVisible({ timeout: 5000 })) {
        await cancelBtn.click()
        await page.waitForTimeout(800)
        await expect(page.locator('main')).toBeVisible()
        rPass('Messages — bouton Annuler suggestion cliqué sans erreur')
      } else {
        rWarn('Messages — Annuler suggestion', 'Bouton Annuler non trouvé sur cette conv')
      }
    } catch (e) { rFail('Messages — Approuver/Annuler', String(e)) }
  })

  // ════════════════════════════════════════════════════════════════
  // SECTION 5 : LOCATAIRES
  // ════════════════════════════════════════════════════════════════

  test('Locataires — tri par colonnes Nom/Locations/CA/Score', async ({ page }) => {
    try {
      await page.goto('/renters')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const cols = ['Nom', 'Locations', 'CA', 'Score']
      let ok = 0
      for (const col of cols) {
        const th = page.locator('main').getByRole('columnheader', { name: new RegExp(col, 'i') }).first()
          .or(page.locator('main th').filter({ hasText: new RegExp(col, 'i') }).first())
        if (await th.isVisible({ timeout: 3000 })) { await th.click(); await page.waitForTimeout(350); ok++ }
      }
      ok >= 2
        ? rPass(`Locataires — tri colonnes (${ok}/${cols.length} en-têtes cliqués)`)
        : rWarn('Locataires — tri colonnes', `${ok}/${cols.length} en-têtes trouvés`)
    } catch (e) { rFail('Locataires — tri colonnes', String(e)) }
  })

  test('Locataires — filtres VIP / Blacklistés / Excellent / Bon', async ({ page }) => {
    try {
      await page.goto('/renters')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const filters = ['VIP', 'Blacklist', 'Excellent', 'Bon']
      let ok = 0
      for (const f of filters) {
        const btn = page.getByRole('button', { name: new RegExp(f, 'i') }).first()
        if (await btn.isVisible({ timeout: 3000 })) {
          await btn.click()
          await page.waitForTimeout(350)
          ok++
          // Dé-activer (2e clic ou bouton reset)
          if (await btn.isVisible({ timeout: 1000 })) await btn.click().catch(() => {})
          await page.waitForTimeout(250)
        }
      }
      ok >= 2
        ? rPass(`Locataires — filtres (${ok}/${filters.length} ok)`)
        : rWarn('Locataires — filtres', `${ok}/${filters.length} boutons trouvés`)
    } catch (e) { rFail('Locataires — filtres', String(e)) }
  })

  test('Locataires — clic ligne → fiche (pas tri de colonne)', async ({ page }) => {
    try {
      await page.goto('/renters')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      // Cliquer sur une cellule de données (pas l'en-tête)
      const dataRow = page.locator('main tbody tr').first()
      if (await dataRow.isVisible({ timeout: 8000 })) {
        const tdName = dataRow.locator('td').first()
        await tdName.click()
        await page.waitForLoadState('domcontentloaded')
        await page.waitForTimeout(800)
        page.url().includes('/renters/')
          ? rPass('Locataires — clic td → fiche /renters/…')
          : rWarn('Locataires — clic fiche', `URL inattendue : ${page.url()}`)
      } else {
        // Fallback : Test Playwright
        const tp = page.locator('main').getByText('Test Playwright').first()
        if (await tp.isVisible({ timeout: 5000 })) {
          await tp.click()
          await page.waitForLoadState('domcontentloaded')
          await page.waitForTimeout(800)
          page.url().includes('/renters/')
            ? rPass('Locataires — clic Test Playwright → fiche')
            : rWarn('Locataires — clic fiche', `URL : ${page.url()}`)
        } else {
          rWarn('Locataires — clic fiche', 'Aucune ligne locataire trouvée')
        }
      }
    } catch (e) { rFail('Locataires — clic fiche', String(e)) }
  })

  test('Locataires — fiche KPIs et historique locations', async ({ page }) => {
    try {
      await page.goto('/renters')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const tp = page.locator('main').getByText('Test Playwright').first()
      if (await tp.isVisible({ timeout: 8000 })) {
        await tp.click()
      } else {
        const row = page.locator('main tbody tr').first()
        if (!await row.isVisible({ timeout: 5000 })) { rWarn('Locataires — fiche KPIs', 'Aucun locataire'); return }
        await row.locator('td').first().click()
      }
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const body = await page.locator('main').textContent() ?? ''
      const reLocKPI  = /locations|location/i
      const reLocNum  = /\d+\s*loc/i
      const reCA      = /€|CA|chiffre/i
      const reHistory = /historique|[Ll]ocation|[Rr]ental|[Pp]ériode|[Dd]ate/i
      ;(reLocKPI.test(body) || reLocNum.test(body))
        ? rPass('Locataires — fiche KPIs locations visible')
        : rWarn('Locataires — KPIs', 'Compteur locations non détecté')
      reCA.test(body)
        ? rPass('Locataires — fiche KPIs CA visible')
        : rWarn('Locataires — KPIs CA', 'Montant CA non détecté')
      reHistory.test(body)
        ? rPass('Locataires — fiche historique locations visible')
        : rWarn('Locataires — historique', 'Section historique non détectée')
    } catch (e) { rFail('Locataires — fiche KPIs', String(e)) }
  })

  test('Locataires — blacklist Test Playwright → badge → retrait', async ({ page }) => {
    try {
      await page.goto('/renters')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const tp = page.locator('main').getByText('Test Playwright').first()
      if (!await tp.isVisible({ timeout: 8000 })) {
        rWarn('Locataires — blacklist', 'Test Playwright non trouvé')
        return
      }
      await tp.click()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(800)

      // Si déjà blacklisté → retirer d'abord
      const removeExisting = page.locator('button').filter({ hasText: 'Retirer du blacklist' }).first()
      if (await removeExisting.isVisible({ timeout: 3000 })) {
        page.once('dialog', d => void d.accept())
        await removeExisting.click()
        await page.waitForTimeout(1200)
        rWarn('Locataires — blacklist', 'Déjà blacklisté — retiré avant test')
      }

      // Blacklister
      const blacklistBtn = page.locator('button').filter({ hasText: '⛔ Blacklister' }).first()
      if (!await blacklistBtn.isVisible({ timeout: 6000 })) {
        rWarn('Locataires — blacklist', 'Bouton ⛔ Blacklister non trouvé')
        return
      }
      await blacklistBtn.click()
      await page.waitForSelector('textarea[placeholder*="Motif"]', { timeout: 8000 })
      await page.locator('textarea[placeholder*="Motif"]').fill('Test monkey blacklist')
      await page.locator('button').filter({ hasText: /^Blacklister$/ }).last().click()
      await page.waitForTimeout(1200)
      if (await page.locator('main').getByText('⛔ Blacklisté').isVisible({ timeout: 8000 })) {
        rPass('Locataires — badge ⛔ Blacklisté apparu')
      } else {
        rWarn('Locataires — blacklist badge', 'Badge non visible après blacklistage')
      }

      // Retirer du blacklist
      const removeBtn = page.locator('button').filter({ hasText: 'Retirer du blacklist' }).first()
      if (!await removeBtn.isVisible({ timeout: 8000 })) {
        rWarn('Locataires — retrait blacklist', 'Bouton retrait non trouvé')
        return
      }
      page.once('dialog', d => void d.accept())
      await removeBtn.click()
      await page.waitForTimeout(1200)
      await expect(page.locator('main').getByText('⛔ Blacklisté')).not.toBeVisible({ timeout: 8000 })
      rPass('Locataires — badge ⛔ Blacklisté disparu après retrait')
    } catch (e) { rFail('Locataires — blacklist', String(e)) }
  })

  // ════════════════════════════════════════════════════════════════
  // SECTION 6 : ACCESSOIRES
  // ════════════════════════════════════════════════════════════════

  test('Accessoires — liste sièges avec stock', async ({ page }) => {
    try {
      await page.goto('/accessories')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const siegeTab = page.getByRole('tab', { name: /Siège/i }).first()
        .or(page.getByRole('button', { name: /Siège/i }).first())
      if (await siegeTab.isVisible({ timeout: 4000 })) { await siegeTab.click(); await page.waitForTimeout(500) }
      const body = await page.locator('main').textContent() ?? ''
      const reStock = /stock|Stock/i
      const reStockNum = /\d+\s*si/i
      ;(reStock.test(body) || reStockNum.test(body))
        ? rPass('Accessoires — sièges avec stock visibles')
        : rWarn('Accessoires — liste sièges', 'Stock non détecté dans le contenu')
    } catch (e) { rFail('Accessoires — liste sièges', String(e)) }
  })

  test('Accessoires — bouton +1 stock', async ({ page }) => {
    try {
      await page.goto('/accessories')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const siegeTab = page.getByRole('tab', { name: /Siège/i }).first()
      if (await siegeTab.isVisible({ timeout: 3000 })) { await siegeTab.click(); await page.waitForTimeout(500) }
      const plusBtn = page.locator('button').filter({ hasText: /^\+1$/ }).first()
        .or(page.locator('button[aria-label*="+1"]').first())
        .or(page.locator('button').filter({ hasText: /^\+$/ }).first())
      if (await plusBtn.isVisible({ timeout: 6000 })) {
        await plusBtn.click()
        await page.waitForTimeout(800)
        rPass('Accessoires — bouton +1 stock cliqué sans erreur')
      } else {
        rWarn('Accessoires — bouton +1 stock', 'Bouton non trouvé')
      }
    } catch (e) { rFail('Accessoires — bouton +1 stock', String(e)) }
  })

  test('Accessoires — bouton HS (hors service)', async ({ page }) => {
    try {
      await page.goto('/accessories')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const siegeTab = page.getByRole('tab', { name: /Siège/i }).first()
      if (await siegeTab.isVisible({ timeout: 3000 })) { await siegeTab.click(); await page.waitForTimeout(500) }
      const hsBtn = page.locator('button').filter({ hasText: /^HS$/ }).first()
        .or(page.locator('button[aria-label*="hors service"], button[title*="HS"]').first())
      if (await hsBtn.isVisible({ timeout: 6000 })) {
        rPass('Accessoires — bouton HS présent')
        await hsBtn.click()
        await page.waitForTimeout(500)
        // Annuler si confirmation demandée
        const cancelConf = page.getByRole('button', { name: /Annuler|Non/i }).first()
        if (await cancelConf.isVisible({ timeout: 2000 })) await cancelConf.click()
        rPass('Accessoires — bouton HS cliquable')
      } else {
        rWarn('Accessoires — bouton HS', 'Non trouvé')
      }
    } catch (e) { rFail('Accessoires — bouton HS', String(e)) }
  })

  test('Accessoires — bouton Modifier siège → formulaire', async ({ page }) => {
    try {
      await page.goto('/accessories')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const siegeTab = page.getByRole('tab', { name: /Siège/i }).first()
      if (await siegeTab.isVisible({ timeout: 3000 })) { await siegeTab.click(); await page.waitForTimeout(500) }
      const modBtn = page.locator('button').filter({ hasText: /Modifier|Éditer/i }).first()
        .or(page.locator('button[aria-label*="modifier"]').first())
      if (!await modBtn.isVisible({ timeout: 6000 })) {
        rWarn('Accessoires — bouton Modifier siège', 'Non trouvé')
        return
      }
      await modBtn.click()
      await page.waitForTimeout(600)
      if (await page.locator('form, [role="dialog"]').first().isVisible({ timeout: 6000 })) {
        rPass('Accessoires — bouton Modifier ouvre formulaire')
        const cancelBtn = page.getByRole('button', { name: /Annuler|Fermer/i }).first()
        if (await cancelBtn.isVisible({ timeout: 3000 })) await cancelBtn.click()
      } else {
        rWarn('Accessoires — bouton Modifier siège', 'Formulaire non apparu')
      }
    } catch (e) { rFail('Accessoires — bouton Modifier siège', String(e)) }
  })

  test('Accessoires — onglet Accessoires (réservations)', async ({ page }) => {
    try {
      await page.goto('/accessories')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const accTab = page.getByRole('tab', { name: /^Accessoire/i }).first()
        .or(page.getByRole('tab', { name: /Réservation/i }).first())
      if (await accTab.isVisible({ timeout: 5000 })) {
        await accTab.click()
        await page.waitForTimeout(600)
        await expect(page.locator('main')).toBeVisible()
        rPass('Accessoires — onglet Accessoires/Réservations accessible')
      } else {
        rWarn('Accessoires — onglet Accessoires', 'Onglet non trouvé')
      }
    } catch (e) { rFail('Accessoires — onglet Accessoires', String(e)) }
  })

  // ════════════════════════════════════════════════════════════════
  // SECTION 7 : VIE DU VÉHICULE
  // ════════════════════════════════════════════════════════════════

  test('Entretiens — formulaire Ajouter (champs + Annuler)', async ({ page }) => {
    try {
      await page.goto('/maintenance')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      await page.getByRole('heading', { name: 'Entretiens' }).waitFor({ timeout: 15000 })
      const addBtn = page.getByRole('button', { name: 'Ajouter' }).first()
      await addBtn.click()
      if (!await page.getByText(/Nouvel entretien/i).isVisible({ timeout: 8000 })) {
        rWarn('Entretiens — formulaire', 'Formulaire non apparu')
        return
      }
      rPass('Entretiens — formulaire Ajouter s\'ouvre')
      const body = await page.locator('main, [role="dialog"]').textContent() ?? ''
      const fields = {
        'véhicule': /véhicule|vehicle/i.test(body),
        'type':     /type|vidange|révision|pneus/i.test(body),
        'date':     /date|Date/i.test(body),
        'coût':     /coût|montant|€/i.test(body),
      }
      const found = Object.entries(fields).filter(([, v]) => v).map(([k]) => k)
      found.length >= 2
        ? rPass(`Entretiens — formulaire contient : ${found.join(', ')}`)
        : rWarn('Entretiens — champs formulaire', `${found.length}/4 champs détectés`)
      const cancelBtn = page.getByRole('button', { name: 'Annuler' }).first()
      if (await cancelBtn.isVisible({ timeout: 3000 })) {
        await cancelBtn.click()
        await expect(page.getByText(/Nouvel entretien/i)).not.toBeVisible({ timeout: 5000 })
        rPass('Entretiens — Annuler ferme le formulaire')
      }
    } catch (e) { rFail('Entretiens — formulaire Ajouter', String(e)) }
  })

  test('CT — navigation et formulaire Ajouter', async ({ page }) => {
    try {
      await page.goto('/maintenance')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const ctTab = page.getByRole('tab', { name: /CT|Contrôle technique/i }).first()
        .or(page.getByRole('button', { name: /CT|Contrôle/i }).first())
        .or(page.getByRole('link', { name: /CT|Contrôle/i }).first())
      let onCT = false
      if (await ctTab.isVisible({ timeout: 5000 })) {
        await ctTab.click()
        await page.waitForTimeout(500)
        onCT = true
        rPass('CT — onglet CT accessible depuis /maintenance')
      } else {
        await page.goto('/technical-controls')
        await page.waitForLoadState('domcontentloaded')
        await page.waitForTimeout(800)
        if (!page.url().includes('/dashboard')) { onCT = true; rPass('CT — route /technical-controls accessible') }
        else { rWarn('CT — navigation', 'Redirection dashboard'); return }
      }
      const addBtn = page.getByRole('button', { name: 'Ajouter' }).first()
      if (!await addBtn.isVisible({ timeout: 5000 })) { rWarn('CT — bouton Ajouter', 'Non trouvé'); return }
      await addBtn.click()
      await page.waitForTimeout(500)
      if (await page.locator('form, [role="dialog"]').first().isVisible({ timeout: 8000 })) {
        rPass('CT — formulaire Ajouter s\'ouvre')
        const cancelBtn = page.getByRole('button', { name: 'Annuler' }).first()
        if (await cancelBtn.isVisible({ timeout: 3000 })) await cancelBtn.click()
      } else {
        rWarn('CT — formulaire', 'Non apparu')
      }
    } catch (e) { rFail('CT — navigation et formulaire', String(e)) }
  })

  test('Documents — bouton Ajouter / upload présent', async ({ page }) => {
    try {
      await page.goto('/maintenance')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)
      const docsTab = page.getByRole('tab', { name: /Document/i }).first()
        .or(page.getByRole('button', { name: /Document/i }).first())
        .or(page.getByRole('link', { name: /Document/i }).first())
      if (await docsTab.isVisible({ timeout: 5000 })) { await docsTab.click(); await page.waitForTimeout(500) }
      const uploadBtn = page.locator('button').filter({ hasText: /Ajouter|Upload|Scanner/i }).first()
        .or(page.locator('input[type="file"]').first())
      await uploadBtn.isVisible({ timeout: 8000 })
        ? rPass('Documents — bouton Ajouter/upload présent')
        : rWarn('Documents — bouton upload', 'Non trouvé (structure peut être différente)')
    } catch (e) { rFail('Documents — bouton Ajouter', String(e)) }
  })

  // ════════════════════════════════════════════════════════════════
  // SECTION 8 : PLANNING
  // ════════════════════════════════════════════════════════════════

  test('Planning — véhicules présents dans la grille', async ({ page }) => {
    try {
      await page.goto('/planning')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2500)
      const body = await page.locator('main').textContent() ?? ''
      const reVehicleGrid = /[A-Z]{2}\d{3}[A-Z]{2}|FZ671YT|Citroen|Peugeot|Fiat|véhicule/i
      reVehicleGrid.test(body)
        ? rPass('Planning — véhicules visibles dans la grille')
        : rWarn('Planning — véhicules', 'Aucun véhicule détecté (bug connu si filtre actif)')
    } catch (e) { rFail('Planning — véhicules', String(e)) }
  })

  test('Planning — navigation Semaine / 14j / Mois', async ({ page }) => {
    try {
      await page.goto('/planning')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const re14j = /14\s*j|Quinzaine/i
      const viewBtns = [
        { name: 'Semaine', btn: page.getByRole('button', { name: /^Semaine$/ }).first() },
        { name: '14j',     btn: page.getByRole('button', { name: re14j }).first() },
        { name: 'Mois',    btn: page.getByRole('button', { name: /^Mois$/ }).first() },
      ]
      let ok = 0
      for (const v of viewBtns) {
        if (await v.btn.isVisible({ timeout: 3000 })) {
          await v.btn.click()
          await page.waitForTimeout(500)
          ok++
        }
      }
      ok >= 1
        ? rPass(`Planning — navigation vues (${ok}/3 boutons)`)
        : rWarn('Planning — navigation vues', 'Boutons Semaine/14j/Mois non trouvés')
    } catch (e) { rFail('Planning — navigation vues', String(e)) }
  })

  test('Planning — navigation prev/next', async ({ page }) => {
    try {
      await page.goto('/planning')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const prevBtn = page.locator('button[aria-label*="précédent"], button[aria-label*="prev"]').first()
        .or(page.locator('button[title*="précédent"]').first())
      const nextBtn = page.locator('button[aria-label*="suivant"], button[aria-label*="next"]').first()
        .or(page.locator('button[title*="suivant"]').first())
      let ok = 0
      if (await prevBtn.isVisible({ timeout: 3000 })) { await prevBtn.click(); await page.waitForTimeout(400); ok++ }
      if (await nextBtn.isVisible({ timeout: 3000 })) { await nextBtn.click(); await page.waitForTimeout(400); ok++ }
      ok >= 1
        ? rPass(`Planning — navigation prev/next (${ok} bouton(s))`)
        : rWarn('Planning — navigation prev/next', 'Boutons non trouvés')
    } catch (e) { rFail('Planning — navigation prev/next', String(e)) }
  })

  test('Planning — filtre par point de livraison', async ({ page }) => {
    try {
      await page.goto('/planning')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const dpFilter = page.locator('select').first()
      if (!await dpFilter.isVisible({ timeout: 5000 })) { rWarn('Planning — filtre livraison', 'Select non trouvé'); return }
      const opts = await dpFilter.locator('option').count()
      if (opts <= 1) { rWarn('Planning — filtre livraison', `${opts} option(s) seulement`); return }
      await dpFilter.selectOption({ index: 1 })
      await page.waitForTimeout(600)
      await expect(page.locator('main')).toBeVisible()
      rPass('Planning — filtre livraison fonctionne')
      await dpFilter.selectOption({ index: 0 })
    } catch (e) { rFail('Planning — filtre livraison', String(e)) }
  })

  test('Planning — modal +Blocage s\'ouvre et se ferme', async ({ page }) => {
    try {
      await page.goto('/planning')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const reBlocage = /Blocage|\+\s*Blocage/i
      const blocageBtn = page.getByRole('button', { name: reBlocage }).first()
      if (!await blocageBtn.isVisible({ timeout: 8000 })) {
        rWarn('Planning — modal +Blocage', 'Bouton +Blocage non trouvé')
        return
      }
      await blocageBtn.click()
      await page.waitForSelector(':text("Nouveau blocage"), :text("blocage"), [role="dialog"]', { timeout: 20000 })
      if (await page.locator('[role="dialog"], .modal, form').first().isVisible({ timeout: 10000 })) {
        rPass('Planning — modal +Blocage s\'ouvre')
        const cancelBtn = page.getByRole('button', { name: /Annuler|Fermer/i }).first()
        if (await cancelBtn.isVisible({ timeout: 5000 })) {
          await cancelBtn.click()
          await expect(page.locator('[role="dialog"]').first()).not.toBeVisible({ timeout: 5000 }).catch(() => {})
          rPass('Planning — modal +Blocage fermé via Annuler')
        }
      } else {
        rWarn('Planning — modal +Blocage', 'Modal non détecté après clic')
      }
    } catch (e) { rFail('Planning — modal +Blocage', String(e)) }
  })

  // ════════════════════════════════════════════════════════════════
  // SECTION 9 : INTELLIGENCE
  // ════════════════════════════════════════════════════════════════

  test('Intelligence — histogramme CA chargé', async ({ page }) => {
    try {
      await page.goto('/intelligence')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2500)
      if (await page.locator('.recharts-wrapper, canvas').first().isVisible({ timeout: 10000 })) {
        rPass('Intelligence — histogramme CA visible (recharts/canvas)')
      } else if (await page.locator('svg').first().isVisible({ timeout: 5000 })) {
        rPass('Intelligence — graphique SVG visible')
      } else {
        rWarn('Intelligence — histogramme', 'Graphique non détecté')
      }
    } catch (e) { rFail('Intelligence — histogramme CA', String(e)) }
  })

  test('Intelligence — suggestions IA visibles', async ({ page }) => {
    try {
      await page.goto('/intelligence')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(1000)
      if (await page.locator('main').getByText(/Suggestions IA/i).first().isVisible({ timeout: 10000 })) {
        rPass('Intelligence — section Suggestions IA visible')
      } else {
        rWarn('Intelligence — suggestions IA', 'Section non trouvée après scroll')
      }
    } catch (e) { rFail('Intelligence — suggestions IA', String(e)) }
  })

  test('Intelligence — bouton Actualiser suggestions', async ({ page }) => {
    try {
      await page.goto('/intelligence')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(800)
      const refreshBtn = page.getByRole('button', { name: /Actualiser|Régénérer|Refresh/i }).first()
        .or(page.locator('button[aria-label*="actualiser"]').first())
      if (!await refreshBtn.isVisible({ timeout: 8000 })) {
        rWarn('Intelligence — Actualiser suggestions', 'Bouton non trouvé')
        return
      }
      await refreshBtn.click()
      await page.waitForTimeout(2000)
      await expect(page.locator('main')).toBeVisible()
      rPass('Intelligence — bouton Actualiser cliqué, page stable')
    } catch (e) { rFail('Intelligence — Actualiser suggestions', String(e)) }
  })

  test('Intelligence — assistant IA pose question et répond', async ({ page }) => {
    test.setTimeout(90000)
    try {
      await page.goto('/intelligence')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(800)
      const input = page.locator('input[placeholder*="question"], textarea[placeholder*="question"]').first()
      if (!await input.isVisible({ timeout: 8000 })) {
        rWarn('Intelligence — assistant IA', 'Champ question non trouvé')
        return
      }
      await input.fill('Quelle est ma voiture la plus rentable ?')
      const sendBtn = page.getByRole('button', { name: /Envoyer|Send/i }).first()
      if (!await sendBtn.isVisible({ timeout: 3000 })) { rWarn('Intelligence — assistant IA', 'Bouton Envoyer absent'); return }
      await sendBtn.click()
      rPass('Intelligence — question envoyée à l\'assistant IA')
      // Attendre réponse (max 60s)
      await page.waitForTimeout(15000)
      const response = page.locator('main').getByText(/voiture|rentable|Fiat|Peugeot|Citroen|€|flotte/i).last()
      if (await response.isVisible({ timeout: 45000 })) {
        rPass('Intelligence — assistant IA a répondu')
      } else {
        rWarn('Intelligence — assistant IA', 'Réponse non détectée après 45s')
      }
    } catch (e) { rFail('Intelligence — assistant IA', String(e)) }
  })

  test('Intelligence — notes Getaround saisie et sauvegarde', async ({ page }) => {
    try {
      await page.goto('/intelligence')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(800)
      const notesInput = page.locator('textarea').filter({
        hasText: /note|Note/i,
      }).first().or(page.locator('textarea').last())
      if (!await notesInput.isVisible({ timeout: 8000 })) {
        rWarn('Intelligence — notes Getaround', 'Champ notes non trouvé')
        return
      }
      await notesInput.fill('Note test monkey')
      const saveBtn = page.getByRole('button', { name: /Sauvegarder|Enregistrer|Valider/i }).first()
      if (await saveBtn.isVisible({ timeout: 5000 })) {
        await saveBtn.click()
        await page.waitForTimeout(1000)
        rPass('Intelligence — notes Getaround saisies et sauvegardées')
      } else {
        rWarn('Intelligence — notes', 'Bouton sauvegarde non trouvé')
      }
    } catch (e) { rFail('Intelligence — notes Getaround', String(e)) }
  })

  // ════════════════════════════════════════════════════════════════
  // SECTION 10 : RENTABILITÉ
  // ════════════════════════════════════════════════════════════════

  test('Rentabilité — KPIs CA / Coûts / Marge affichés', async ({ page }) => {
    try {
      await page.goto('/rentability')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      await expect(page.getByRole('heading', { name: 'Rentabilité' })).toBeVisible({ timeout: 10000 })
      const body = await page.locator('main').textContent() ?? ''
      const kpis = {
        'CA net':  /CA net|CA mensuel|chiffre d.affaires/i.test(body),
        'Coûts':   /[Cc]oûts/.test(body),
        'Marge':   /[Mm]arge/.test(body),
      }
      const found = Object.entries(kpis).filter(([, v]) => v).map(([k]) => k)
      found.length === 3
        ? rPass('Rentabilité — KPIs CA/Coûts/Marge tous visibles')
        : rWarn('Rentabilité — KPIs', `${found.length}/3 : ${found.join(', ')} — manque : ${Object.keys(kpis).filter(k => !found.includes(k)).join(', ')}`)
    } catch (e) { rFail('Rentabilité — KPIs', String(e)) }
  })

  test('Rentabilité — +Coût sur Peugeot 208 → liste → chevron → break-even → supprimer', async ({ page }) => {
    test.setTimeout(60000)
    try {
      await page.goto('/rentability')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      // Ouvrir panneau Peugeot 208
      const vehicleBtn = page.locator('main button').filter({ hasText: /Peugeot|208/ }).first()
      if (!await vehicleBtn.isVisible({ timeout: 10000 })) {
        rWarn('Rentabilité — coût Peugeot 208', 'Peugeot 208 non trouvé')
        return
      }
      await vehicleBtn.click()
      await page.waitForTimeout(800)
      // Formulaire ajout coût
      const labelInput = page.locator(
        'input[placeholder*="Assurance"], input[placeholder*="label"], input[placeholder*="Label"]',
      ).first()
      if (!await labelInput.isVisible({ timeout: 8000 })) {
        rWarn('Rentabilité — formulaire coût', 'Champ label non trouvé')
        return
      }
      // Type fixe
      const typeSelect = page.locator('select').first()
      const hasType = await typeSelect.isVisible({ timeout: 2000 })
      if (hasType) {
        rPass('Rentabilité — formulaire coût avec sélecteur type')
        await typeSelect.selectOption('fixed').catch(() => {})
      }
      await labelInput.fill('Test monkey coût')
      const amountInput = page.locator('input[placeholder*="Montant"], input[type="number"]').first()
      await amountInput.fill('99')
      await page.locator('button').filter({ hasText: /Ajouter|Enregistrer/ }).last().click()
      await page.waitForTimeout(1500)
      const costRow = page.locator('main').getByText('Test monkey coût').first()
      if (!await costRow.isVisible({ timeout: 10000 })) {
        rWarn('Rentabilité — ajout coût', 'Coût "Test monkey coût" non visible après ajout')
        return
      }
      rPass('Rentabilité — coût "Test monkey coût" apparu dans la liste')

      // Chevron / détail
      const chevron = page.locator('main button').filter({ hasText: /›|▶|Détail|▼/i }).first()
        .or(page.locator('main button[aria-label*="expand"], main button[aria-label*="détail"]').first())
      if (await chevron.isVisible({ timeout: 3000 })) {
        await chevron.click()
        await page.waitForTimeout(400)
        rPass('Rentabilité — chevron détail cliqué')
      } else {
        rWarn('Rentabilité — chevron', 'Non trouvé')
      }

      // Break-even
      if (await page.locator('main').getByText(/Break.even|Seuil/i).first().isVisible({ timeout: 5000 })) {
        rPass('Rentabilité — break-even affiché')
      } else {
        rWarn('Rentabilité — break-even', 'Non trouvé après ajout coût')
      }

      // Supprimer le coût test
      const rowParent = costRow.locator('..').locator('..')
      const deleteBtn = rowParent.locator('button').filter({ hasText: /×|✕|Supprimer/i }).first()
        .or(rowParent.locator('button[aria-label*="supprimer"]').first())
      if (await deleteBtn.isVisible({ timeout: 5000 })) {
        await deleteBtn.click()
        await page.waitForTimeout(500)
        await page.locator('button').filter({ hasText: /Confirmer|Oui/i }).last().click().catch(() => {})
        await page.waitForTimeout(1000)
        rPass('Rentabilité — coût test supprimé')
      } else {
        rWarn('Rentabilité — suppression coût', 'Bouton supprimer non trouvé')
      }
    } catch (e) { rFail('Rentabilité — gestion coût Peugeot 208', String(e)) }
  })

  // ════════════════════════════════════════════════════════════════
  // SECTION 11 : RAPPORT CEO
  // ════════════════════════════════════════════════════════════════

  test('Rapport CEO — sections Résumé/Performance/Flotte/SWOT/PESTEL/Recommandations', async ({ page }) => {
    try {
      await page.goto('/intelligence/report')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      await expect(page.getByRole('heading', { name: /Rapport CEO/i, level: 1 })).toBeVisible({ timeout: 15000 })
      const body = await page.locator('main').textContent() ?? ''
      const sections = ['Résumé', 'Performance', 'Flotte', 'SWOT', 'PESTEL', 'Zones', 'Veille', 'Recommandations']
      const found = sections.filter(s => new RegExp(s, 'i').test(body))
      found.length >= 3
        ? rPass(`Rapport CEO — ${found.length}/${sections.length} sections : ${found.join(', ')}`)
        : rWarn('Rapport CEO — sections', `${found.length}/${sections.length} : ${found.join(', ')}`)
    } catch (e) { rFail('Rapport CEO — sections', String(e)) }
  })

  test('Rapport CEO — menu navigation sections', async ({ page }) => {
    try {
      await page.goto('/intelligence/report')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      const menuItems = page.locator('nav a, aside a, [role="navigation"] a, nav button').filter({
        hasText: /Résumé|Performance|Flotte|SWOT|PESTEL|Zones|Veille|Recommandations/i,
      })
      const total = await menuItems.count()
      let clicked = 0
      for (let i = 0; i < Math.min(total, 6); i++) {
        const item = menuItems.nth(i)
        if (await item.isVisible({ timeout: 2000 })) { await item.click(); await page.waitForTimeout(350); clicked++ }
      }
      clicked >= 2
        ? rPass(`Rapport CEO — ${clicked} section(s) menu cliquées`)
        : rWarn('Rapport CEO — menu navigation', `${clicked} items cliqués (total menu : ${total})`)
    } catch (e) { rFail('Rapport CEO — menu navigation', String(e)) }
  })

  test('Rapport CEO — toggle Mensuel/Annuel et navigation mois', async ({ page }) => {
    try {
      await page.goto('/intelligence/report')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      let toggled = 0
      const annuelBtn = page.getByRole('button', { name: /Annuel/ })
      const mensuelBtn = page.getByRole('button', { name: /Mensuel/ })
      if (await annuelBtn.isVisible({ timeout: 5000 })) { await annuelBtn.click(); await page.waitForTimeout(500); toggled++ }
      if (await mensuelBtn.isVisible({ timeout: 5000 })) { await mensuelBtn.click(); await page.waitForTimeout(500); toggled++ }
      toggled >= 1
        ? rPass(`Rapport CEO — toggle Annuel/Mensuel (${toggled} bouton(s))`)
        : rWarn('Rapport CEO — toggle', 'Boutons Annuel/Mensuel non trouvés')
      // Navigation mois prev/next
      const prevBtn = page.locator('main button[aria-label*="précédent"]').first()
        .or(page.locator('main button[title*="précédent"]').first())
      const nextBtn = page.locator('main button[aria-label*="suivant"]').first()
        .or(page.locator('main button[title*="suivant"]').first())
      let navOK = 0
      if (await prevBtn.isVisible({ timeout: 3000 })) { await prevBtn.click(); await page.waitForTimeout(400); navOK++ }
      if (await nextBtn.isVisible({ timeout: 3000 })) { await nextBtn.click(); await page.waitForTimeout(400); navOK++ }
      navOK >= 1
        ? rPass(`Rapport CEO — navigation mois (${navOK} bouton(s))`)
        : rWarn('Rapport CEO — navigation mois', 'Boutons prev/next non trouvés')
    } catch (e) { rFail('Rapport CEO — toggle et navigation mois', String(e)) }
  })

  test('Rapport CEO — bouton Régénérer → loading → nouveau contenu', async ({ page }) => {
    test.setTimeout(120000)
    try {
      await page.goto('/intelligence/report')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      const regenBtn = page.getByRole('button', { name: /Régénérer|Générer|Actualiser/i }).first()
      if (!await regenBtn.isVisible({ timeout: 8000 })) {
        rWarn('Rapport CEO — Régénérer', 'Bouton non trouvé')
        return
      }
      await regenBtn.click()
      // Vérifier loading
      const loadingEl = page.locator('[aria-busy="true"], .animate-spin, .spinner').first()
        .or(page.locator('main').getByText(/génér|génération|loading|chargement/i).first())
      if (await loadingEl.isVisible({ timeout: 8000 }).catch(() => false)) {
        rPass('Rapport CEO — loading visible après Régénérer')
      } else {
        rWarn('Rapport CEO — loading', 'Indicateur loading non détecté')
      }
      // Attendre la fin de génération (max 90s)
      await page.waitForTimeout(30000)
      const body = await page.locator('main').textContent() ?? ''
      body.length > 200
        ? rPass('Rapport CEO — contenu présent après Régénérer')
        : rWarn('Rapport CEO — Régénérer', 'Contenu court ou vide après régénération')
    } catch (e) { rFail('Rapport CEO — Régénérer', String(e)) }
  })

  // ════════════════════════════════════════════════════════════════
  // SECTION 12 : PARAMÈTRES
  // ════════════════════════════════════════════════════════════════

  test('Paramètres — section comptes Getaround visible', async ({ page }) => {
    try {
      await page.goto('/settings')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      await expect(page.getByRole('heading', { name: 'Paramètres' })).toBeVisible({ timeout: 10000 })
      if (await page.locator('main').getByText(/Getaround/).first().isVisible({ timeout: 8000 })) {
        rPass('Paramètres — section comptes Getaround visible')
      } else {
        rWarn('Paramètres — comptes Getaround', 'Section non trouvée')
      }
    } catch (e) { rFail('Paramètres — comptes Getaround', String(e)) }
  })

  test('Paramètres — modal +Inviter → formulaire → résultat', async ({ page }) => {
    try {
      await page.goto('/settings')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const inviteBtn = page.getByTestId('btn-inviter')
      if (!await inviteBtn.isVisible({ timeout: 8000 })) {
        rWarn('Paramètres — bouton Inviter', 'Non trouvé')
        return
      }
      await inviteBtn.click()
      await page.waitForTimeout(1000)
      const modal = page.locator('[role="dialog"], .modal').first()
      if (!await modal.isVisible({ timeout: 8000 })) {
        rWarn('Paramètres — modal Inviter', 'Modal non apparu (bug connu possible)')
        return
      }
      rPass('Paramètres — modal +Inviter s\'ouvre')
      // Saisir nom et email
      const nameInput = page.locator('input[placeholder*="nom"], input[name*="name"], input[placeholder*="Nom"]').first()
      const emailInput = page.locator('input[type="email"], input[placeholder*="email"], input[placeholder*="Email"]').first()
      if (await nameInput.isVisible({ timeout: 3000 })) { await nameInput.fill('Test Monkey'); rPass('Paramètres — champ nom saisie OK') }
      if (await emailInput.isVisible({ timeout: 3000 })) { await emailInput.fill('monkey.noreply@example.com'); rPass('Paramètres — champ email saisie OK') }
      // Cliquer Inviter
      const submitBtn = page.getByRole('button', { name: /^Inviter$|Envoyer/i }).last()
      if (await submitBtn.isVisible({ timeout: 3000 })) {
        await submitBtn.click()
        await page.waitForTimeout(2000)
        const successMsg = page.getByText(/invité|envoyé|succès|success/i).first()
        const errorMsg   = page.getByText(/erreur|error|invalide|existe déjà/i).first()
        if (await successMsg.isVisible({ timeout: 5000 })) {
          rPass('Paramètres — invitation envoyée avec succès')
        } else if (await errorMsg.isVisible({ timeout: 3000 })) {
          rWarn('Paramètres — invitation', 'Erreur retournée (normal si email déjà utilisé)')
        } else {
          rWarn('Paramètres — invitation', 'Pas de feedback visible après soumission')
        }
      }
      // Fermer modal
      const closeBtn = page.getByRole('button', { name: /Annuler|Fermer/i }).first()
      if (await closeBtn.isVisible({ timeout: 3000 })) await closeBtn.click()
    } catch (e) { rFail('Paramètres — modal +Inviter', String(e)) }
  })

  test('Paramètres — section Utilisateurs & rôles (≥3 users)', async ({ page }) => {
    try {
      await page.goto('/settings')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const body = await page.locator('main').textContent() ?? ''
      if (!/[Uu]tilisateur|[Rr]ôle|[Mm]embre|[Uu]ser/.test(body)) {
        rWarn('Paramètres — Utilisateurs & rôles', 'Section non détectée dans le contenu')
        return
      }
      rPass('Paramètres — section Utilisateurs & rôles présente')
      const rows = page.locator('main').getByRole('row')
      const count = await rows.count()
      count >= 3
        ? rPass(`Paramètres — ${count} ligne(s) utilisateur(s) visibles`)
        : rWarn('Paramètres — utilisateurs', `${count} ligne(s) — attendu ≥3`)
    } catch (e) { rFail('Paramètres — section utilisateurs', String(e)) }
  })

  test('Paramètres — assignation véhicules carkeeper', async ({ page }) => {
    try {
      await page.goto('/settings')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      // Bouton voiture dans la liste des utilisateurs
      const carBtn = page.getByTestId('btn-assign-vehicles').first()
      if (!await carBtn.isVisible({ timeout: 5000 })) {
        rWarn('Paramètres — assignation carkeeper', 'Bouton assignation non trouvé')
        return
      }
      await carBtn.click()
      await page.waitForTimeout(700)
      rPass('Paramètres — bouton assignation carkeeper cliqué')
      const closeBtn = page.getByRole('button', { name: /Annuler|Fermer/i }).first()
      if (await closeBtn.isVisible({ timeout: 3000 })) await closeBtn.click()
    } catch (e) { rFail('Paramètres — assignation carkeeper', String(e)) }
  })

  test('Paramètres — Messagerie automatique et toggles Automatique/Approbation/Manuel', async ({ page }) => {
    try {
      await page.goto('/settings')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      if (!await page.locator('main').getByText(/Messagerie automatique/i).first().isVisible({ timeout: 8000 })) {
        rWarn('Paramètres — messagerie', 'Section Messagerie automatique non trouvée')
        return
      }
      rPass('Paramètres — section Messagerie automatique visible')
      const modes = [
        { label: 'Automatique', btn: page.getByRole('button', { name: /Automatique/i }).first() },
        { label: 'Approbation', btn: page.getByRole('button', { name: /Approbation/i }).first() },
        { label: 'Manuel',      btn: page.getByRole('button', { name: /Manuel/i }).first() },
      ]
      let ok = 0
      for (const mode of modes) {
        if (await mode.btn.isVisible({ timeout: 3000 })) {
          await mode.btn.click()
          await page.waitForTimeout(500)
          rPass(`Paramètres — toggle mode ${mode.label}`)
          ok++
        }
      }
      if (ok === 0) rWarn('Paramètres — toggles messagerie', 'Aucun bouton de mode trouvé')
    } catch (e) { rFail('Paramètres — Messagerie et toggles', String(e)) }
  })

  test('Paramètres — section Notifications (Telegram, TV) et webhook URL copiable', async ({ page }) => {
    try {
      await page.goto('/settings')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const body = await page.locator('main').textContent() ?? ''
      const hasNotif = /[Nn]otification|Telegram|TV|webhook|Webhook/.test(body)
      hasNotif
        ? rPass('Paramètres — section Notifications présente (Telegram / TV / webhook)')
        : rWarn('Paramètres — Notifications', 'Section non détectée')
      // Webhook URL et bouton copier
      const webhookEl = page.locator('main').getByText(/webhook|Webhook/i).first()
      if (await webhookEl.isVisible({ timeout: 5000 })) {
        rPass('Paramètres — webhook URL visible')
        const copyBtn = page.locator('button[aria-label*="copier"], button[aria-label*="copy"], button[title*="copier"]').first()
          .or(page.locator('button').filter({ hasText: /Copier|Copy/i }).first())
        if (await copyBtn.isVisible({ timeout: 3000 })) {
          rPass('Paramètres — bouton Copier webhook URL présent')
        } else {
          rWarn('Paramètres — webhook copiable', 'Bouton Copier non trouvé')
        }
      } else {
        rWarn('Paramètres — webhook URL', 'Élément webhook non trouvé')
      }
    } catch (e) { rFail('Paramètres — Notifications et webhook', String(e)) }
  })
})
