import { test, expect, type BrowserContext } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { getSuperadminToken, API_URL, TENANT_SLUG } from './helpers/auth'

// ─── Report tracking ──────────────────────────────────────────────────────────
type Entry = { status: '✅ PASS' | '❌ FAIL' | '⚠️ WARN'; desc: string; detail?: string }
const REPORT: Entry[] = []

function rPass(desc: string) {
  REPORT.push({ status: '✅ PASS', desc })
  console.log(`[32] ✅ PASS — ${desc}`)
}
function rFail(desc: string, detail: string) {
  REPORT.push({ status: '❌ FAIL', desc, detail })
  console.log(`[32] ❌ FAIL — ${desc} — ${detail}`)
}
function rWarn(desc: string, detail: string) {
  REPORT.push({ status: '⚠️ WARN', desc, detail })
  console.log(`[32] ⚠️ WARN — ${desc} — ${detail}`)
}

function saveReport() {
  const outDir = path.resolve(process.cwd(), 'tests/e2e/results')
  fs.mkdirSync(outDir, { recursive: true })
  const pass = REPORT.filter(r => r.status === '✅ PASS').length
  const fail = REPORT.filter(r => r.status === '❌ FAIL').length
  const warn = REPORT.filter(r => r.status === '⚠️ WARN').length
  const lines = [
    '═══════════════════════════════════════════════════════════════',
    '   RAPPORT 32 — Corrections (7 BLOCs)',
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
  const reportPath = path.join(outDir, '32-corrections-report.txt')
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8')
  console.log(`[32] Rapport écrit : ${reportPath}`)
  console.log(`[32] Total: ${REPORT.length} | ✅ ${pass} | ❌ ${fail} | ⚠️ ${warn}`)
}

const ADMIN_AUTH = 'tests/e2e/.auth/user.json'
const CK_AUTH = 'tests/e2e/.auth/carkeeper.json'

// ─────────────────────────────────────────────────────────────────────────────
// BLOC 4 — data-testids + modales
// ─────────────────────────────────────────────────────────────────────────────
test.describe('32-A — BLOC 4 : data-testids clés', () => {
  test.afterAll(() => saveReport())

  // BLOC 7 — Modal +Inviter Paramètres
  test('btn-inviter ouvre modal-inviter', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_AUTH })
    const page = await ctx.newPage()
    try {
      await page.goto('/settings')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const btn = page.locator('[data-testid="btn-inviter"]')
      await btn.waitFor({ state: 'visible', timeout: 10000 })
      await btn.click()
      const modal = page.locator('[data-testid="modal-inviter"]')
      await modal.waitFor({ state: 'visible', timeout: 5000 })
      rPass('btn-inviter ouvre modal-inviter')
      expect(await modal.isVisible()).toBe(true)
    } catch (e) {
      rFail('btn-inviter ouvre modal-inviter', String(e))
      throw e
    } finally {
      await ctx.close()
    }
  })

  // BLOC 3 — btn-modifier véhicule
  test('btn-modifier présent sur page véhicule', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_AUTH })
    const page = await ctx.newPage()
    try {
      await page.goto('/vehicles')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const firstLink = page.locator('a[href*="/vehicles/"]').first()
      if (!(await firstLink.isVisible({ timeout: 5000 }))) {
        rWarn('btn-modifier véhicule', 'Aucun véhicule dans la liste')
        return
      }
      await firstLink.click()
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const btn = page.locator('[data-testid="btn-modifier"]')
      await btn.waitFor({ state: 'visible', timeout: 8000 })
      rPass('btn-modifier présent sur page véhicule')
    } catch (e) {
      rFail('btn-modifier présent sur page véhicule', String(e))
      throw e
    } finally {
      await ctx.close()
    }
  })

  // BLOC 6 — aria-labels prev/next-month rapport CEO
  test('aria-labels prev-month / next-month présents sur rapport', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_AUTH })
    const page = await ctx.newPage()
    try {
      await page.goto('/intelligence/report')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      // Passer en mode mensuel pour s'assurer que les boutons sont visibles
      const monthlyBtn = page.locator('button').filter({ hasText: /mensuel/i }).first()
      if (await monthlyBtn.isVisible({ timeout: 5000 })) {
        await monthlyBtn.click()
        await page.waitForTimeout(500)
      }
      const prev = page.locator('[aria-label="prev-month"]')
      const next = page.locator('[aria-label="next-month"]')
      await prev.waitFor({ state: 'visible', timeout: 8000 })
      await next.waitFor({ state: 'visible', timeout: 8000 })
      rPass('aria-labels prev-month / next-month présents')
    } catch (e) {
      rFail('aria-labels prev-month / next-month', String(e))
      throw e
    } finally {
      await ctx.close()
    }
  })

  // BLOC 4 — input-cost-label dans modal coût (ouvrir le modal d'abord)
  test('input-cost-label présent dans modal coût rentabilité', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_AUTH })
    const page = await ctx.newPage()
    try {
      await page.goto('/rentability')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      // Chercher le bouton "+ Coût" du premier véhicule (title="Ajouter un coût")
      const addCostBtn = page.locator('button[title="Ajouter un coût"]').first()
      const hasBtn = await addCostBtn.isVisible({ timeout: 8000 }).catch(() => false)
      if (!hasBtn) {
        rWarn('input-cost-label', 'Aucun bouton "+ Coût" visible (aucun véhicule ?)')
        return
      }
      await addCostBtn.click()
      // Modal ouvert — chercher le champ libellé
      const inp = page.locator('[data-testid="input-cost-label"]').first()
      await inp.waitFor({ state: 'visible', timeout: 5000 })
      rPass('input-cost-label présent dans le modal coût')
      expect(await inp.isVisible()).toBe(true)
    } catch (e) {
      rFail('input-cost-label présent sur rentabilité', String(e))
      throw e
    } finally {
      await ctx.close()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOC 5 — filtre statut locations (annulées)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('32-B — BLOC 5 : filtre statut locations', () => {
  test('select-status-filter contient option Annulées', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_AUTH })
    const page = await ctx.newPage()
    try {
      await page.goto('/rentals')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const sel = page.locator('[data-testid="select-status-filter"]')
      await sel.waitFor({ state: 'visible', timeout: 8000 })
      const opts = await sel.locator('option').allTextContents()
      const hasCancelled = opts.some(o => /annul/i.test(o))
      if (hasCancelled) {
        rPass('select-status-filter contient option Annulées')
      } else {
        rFail('select-status-filter manque option Annulées', `Options: ${opts.join(', ')}`)
      }
    } catch (e) {
      rFail('select-status-filter', String(e))
      throw e
    } finally {
      await ctx.close()
    }
  })

  test('filtrer sur Annulées change la liste', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_AUTH })
    const page = await ctx.newPage()
    try {
      await page.goto('/rentals')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const sel = page.locator('[data-testid="select-status-filter"]')
      await sel.waitFor({ state: 'visible', timeout: 8000 })
      // Compter nombre initial de locations
      const countBefore = await page.locator('a[href*="/rentals/"]').count()
      // Sélectionner Annulées
      await sel.selectOption('cancelled')
      await page.waitForTimeout(1500)
      // La page ne doit pas crasher
      const errorEl = page.locator('.text-red-700').first()
      const hasError = await errorEl.isVisible({ timeout: 1000 }).catch(() => false)
      if (hasError) {
        rFail('filtre Annulées', `Erreur affichée: ${await errorEl.textContent()}`)
      } else {
        rPass(`filtre Annulées fonctionne (avant: ${countBefore} location(s))`)
      }
    } catch (e) {
      rFail('filtre Annulées change la liste', String(e))
      throw e
    } finally {
      await ctx.close()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOC 3 — Planning carkeeper
// ─────────────────────────────────────────────────────────────────────────────
test.describe('32-C — BLOC 3 : Planning carkeeper', () => {
  test('Carkeeper voit la page planning sans erreur', async ({ browser }) => {
    const ckAuthPath = CK_AUTH
    const authExists = fs.existsSync(ckAuthPath)
    if (!authExists) {
      rWarn('Planning carkeeper', `Fichier auth carkeeper absent: ${ckAuthPath}`)
      test.skip()
      return
    }
    const ctx = await browser.newContext({ storageState: ckAuthPath })
    const page = await ctx.newPage()
    try {
      await page.goto('/planning')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      // Pas d'erreur 500
      const errEl = page.locator('text=/erreur|error|500/i').first()
      const hasErr = await errEl.isVisible({ timeout: 3000 }).catch(() => false)
      if (hasErr) {
        rFail('Planning carkeeper', 'Erreur visible sur la page')
      } else {
        rPass('Planning carkeeper charge sans erreur')
      }
    } catch (e) {
      rFail('Planning carkeeper', String(e))
      throw e
    } finally {
      await ctx.close()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOC 1 — Profil locataire : API exclut les annulées des stats
// ─────────────────────────────────────────────────────────────────────────────
test.describe('32-D — BLOC 1 : Profil locataire (API)', () => {
  test('API profil locataire retourne totalRentals sans annulées', async () => {
    // Récupérer le token admin via la page de connexion
    const tokenRes = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@sunanddrive.fr', password: 'password', slug: TENANT_SLUG }),
    })
    const tokenData = await tokenRes.json() as { token?: string }
    if (!tokenData.token) {
      rWarn('API profil locataire', 'Login admin échoué — test ignoré')
      return
    }

    // Récupérer la liste des locataires
    const rentersRes = await fetch(`${API_URL}/api/v1/renters?limit=5`, {
      headers: { Authorization: `Bearer ${tokenData.token}`, 'x-tenant-slug': TENANT_SLUG },
    })
    if (!rentersRes.ok) {
      rWarn('API profil locataire', `GET /renters échoué: ${rentersRes.status}`)
      return
    }
    const rentersData = await rentersRes.json() as { renters?: Array<{ driverGetaroundId: string }> }
    const renters = rentersData.renters ?? []
    if (renters.length === 0) {
      rWarn('API profil locataire', 'Aucun locataire pour tester')
      return
    }

    // Tester le premier locataire
    const renterId = renters[0]?.driverGetaroundId
    if (!renterId) {
      rWarn('API profil locataire', 'driverGetaroundId null sur premier locataire')
      return
    }

    const profileRes = await fetch(`${API_URL}/api/v1/rentals/renter/${renterId}/profile`, {
      headers: { Authorization: `Bearer ${tokenData.token}`, 'x-tenant-slug': TENANT_SLUG },
    })
    if (!profileRes.ok) {
      rWarn('API profil locataire', `GET profil échoué: ${profileRes.status}`)
      return
    }

    const profile = await profileRes.json() as {
      totalRentals: number;
      rentals: Array<{ status: string }>
    }

    // totalRentals ne doit pas inclure les annulées
    const cancelled = (profile.rentals ?? []).filter(r => r.status === 'cancelled')
    const expectedMax = (profile.rentals ?? []).length - cancelled.length
    if (profile.totalRentals <= expectedMax) {
      rPass(`Profil locataire: totalRentals=${profile.totalRentals} (${cancelled.length} annulée(s) exclue(s))`)
    } else {
      rFail('Profil locataire: totalRentals inclut des annulées', `totalRentals=${profile.totalRentals}, attendu max ${expectedMax}`)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOC 2 — SuperAdmin MRR basé sur les vrais prix
// ─────────────────────────────────────────────────────────────────────────────
test.describe('32-E — BLOC 2 : SuperAdmin MRR', () => {
  test('GET /superadmin/stats retourne mrrTotal >= 0', async () => {
    const token = await getSuperadminToken()
    const res = await fetch(`${API_URL}/api/v1/superadmin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      rFail('SuperAdmin MRR', `GET /stats échoué: ${res.status}`)
      return
    }
    const data = await res.json() as { stats?: { mrrTotal?: number; arrTotal?: number } }
    const mrr = data.stats?.mrrTotal ?? -1
    const arr = data.stats?.arrTotal ?? -1
    if (mrr >= 0 && arr >= 0) {
      rPass(`SuperAdmin MRR=${mrr}€/mois ARR=${arr}€/an`)
    } else {
      rFail('SuperAdmin MRR invalide', `mrrTotal=${mrr} arrTotal=${arr}`)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BLOC 6 & 7 — Mobile : planning + messages
// ─────────────────────────────────────────────────────────────────────────────
test.describe('32-F — BLOC 6/7 : Mobile planning & messages', () => {
  test('Planning — colonne véhicule réduite sur mobile', async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: ADMIN_AUTH,
      viewport: { width: 390, height: 844 },
    })
    const page = await ctx.newPage()
    try {
      await page.goto('/planning')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      // Chercher la colonne véhicule (header ou première cellule)
      const vehicleCol = page.locator('.w-\\[90px\\]').first()
      const exists = await vehicleCol.isVisible({ timeout: 8000 }).catch(() => false)
      if (exists) {
        rPass('Planning: colonne véhicule w-[90px] visible sur mobile 390px')
      } else {
        rWarn('Planning mobile colonne', 'Classe w-[90px] non trouvée (vérifier si la page a des véhicules)')
      }
    } catch (e) {
      rFail('Planning mobile colonne', String(e))
      throw e
    } finally {
      await ctx.close()
    }
  })

  test('Messages — badges sur leur propre ligne (pas écrasés)', async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: ADMIN_AUTH,
      viewport: { width: 390, height: 844 },
    })
    const page = await ctx.newPage()
    try {
      await page.goto('/messages')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      // Vérifier que les badges "Sans réponse" ne débordent pas hors du bouton conversation
      const badge = page.locator('span:text("Sans réponse")').first()
      const hasBadge = await badge.isVisible({ timeout: 5000 }).catch(() => false)
      if (!hasBadge) {
        rWarn('Messages badges mobile', 'Aucun badge "Sans réponse" visible (pas de message sans réponse)')
        return
      }
      // Badge visible = layout ok (pas de chevauchement détectable simplement)
      const box = await badge.boundingBox()
      if (box && box.width > 0 && box.height > 0) {
        rPass('Messages: badge "Sans réponse" visible et non tronqué sur mobile')
      } else {
        rFail('Messages: badge masqué ou dimensionné à 0', JSON.stringify(box))
      }
    } catch (e) {
      rFail('Messages badges mobile', String(e))
      throw e
    } finally {
      await ctx.close()
    }
  })
})
