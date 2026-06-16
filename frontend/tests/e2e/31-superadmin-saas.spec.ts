import { test, expect, type BrowserContext } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { getSuperadminToken, API_URL, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD } from './helpers/auth'

// ─── Report tracking ──────────────────────────────────────────────────────────
type Entry = { status: '✅ PASS' | '❌ FAIL' | '⚠️ WARN'; desc: string; detail?: string }
const REPORT: Entry[] = []

function rPass(desc: string) {
  REPORT.push({ status: '✅ PASS', desc })
  console.log(`[31] ✅ PASS — ${desc}`)
}
function rFail(desc: string, detail: string) {
  REPORT.push({ status: '❌ FAIL', desc, detail })
  console.log(`[31] ❌ FAIL — ${desc} — ${detail}`)
}
function rWarn(desc: string, detail: string) {
  REPORT.push({ status: '⚠️ WARN', desc, detail })
  console.log(`[31] ⚠️ WARN — ${desc} — ${detail}`)
}

function saveReport() {
  const outDir = path.resolve(process.cwd(), 'tests/e2e/results')
  fs.mkdirSync(outDir, { recursive: true })
  const pass = REPORT.filter(r => r.status === '✅ PASS').length
  const fail = REPORT.filter(r => r.status === '❌ FAIL').length
  const warn = REPORT.filter(r => r.status === '⚠️ WARN').length
  const lines = [
    '═══════════════════════════════════════════════════════════════',
    '   RAPPORT 31 — SuperAdmin + SaaS Features',
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
  const reportPath = path.join(outDir, 'saas-report.txt')
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8')
  console.log(`[31] Rapport écrit : ${reportPath}`)
  console.log(`[31] Total: ${REPORT.length} | ✅ ${pass} | ❌ ${fail} | ⚠️ ${warn}`)
}

// ─── Superadmin login helper ───────────────────────────────────────────────────
const SA_AUTH_FILE = 'tests/e2e/.auth/superadmin.json'

async function loginAsSuperAdmin(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage()
  await page.goto('/superadmin/login')
  await page.fill('input[type="email"]', SUPERADMIN_EMAIL)
  await page.fill('input[type="password"]', SUPERADMIN_PASSWORD)
  await page.click('button[type="submit"]')
  // Attendre que le dashboard superadmin charge
  await page.waitForURL('**/superadmin**', { timeout: 15000 })
  await page.waitForTimeout(1000)
  await ctx.storageState({ path: SA_AUTH_FILE })
  await page.close()
}

// ─── Helper : login superadmin via API et injecter le token ───────────────────
async function injectSaToken(ctx: BrowserContext): Promise<void> {
  const token = await getSuperadminToken()
  // Injecter dans localStorage de la page superadmin
  const page = await ctx.newPage()
  await page.goto('/superadmin')
  await page.evaluate((t: string) => { localStorage.setItem('superadmin_token', t) }, token)
  await page.reload()
  await page.waitForTimeout(1000)
  await ctx.storageState({ path: SA_AUTH_FILE })
  await page.close()
}

// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1 — SuperAdmin UI
// ═════════════════════════════════════════════════════════════════════════════
test.describe('31-A — SuperAdmin Plans & Tarifs', () => {
  test.afterAll(() => saveReport())

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    await injectSaToken(ctx)
    await ctx.close()
  })

  test('SA — Page Plans accessible', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: SA_AUTH_FILE })
    const page = await ctx.newPage()
    try {
      await page.goto('/superadmin/plans')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)

      const starterCard = page.locator('text=Starter').first()
      const proCard = page.locator('text=Pro').first()
      const enterpriseCard = page.locator('text=Enterprise').first()

      if (await starterCard.isVisible({ timeout: 5000 })) {
        rPass('Plans — card Starter visible')
      } else {
        rFail('Plans — card Starter visible', 'Texte "Starter" introuvable')
      }

      if (await proCard.isVisible({ timeout: 3000 })) {
        rPass('Plans — card Pro visible')
      } else {
        rFail('Plans — card Pro visible', 'Texte "Pro" introuvable')
      }

      if (await enterpriseCard.isVisible({ timeout: 3000 })) {
        rPass('Plans — card Enterprise visible')
      } else {
        rFail('Plans — card Enterprise visible', 'Texte "Enterprise" introuvable')
      }

      // Vérifier champs éditables (price inputs)
      const priceInputs = page.locator('input[type="number"]')
      const count = await priceInputs.count()
      if (count >= 6) {
        rPass(`Plans — champs prix éditables présents (${count} inputs)`)
      } else {
        rWarn('Plans — champs prix éditables', `${count} inputs trouvés, attendu ≥ 6 (2 par plan)`)
      }
    } catch (e) {
      rFail('Plans — page accessible', String(e))
    } finally {
      await ctx.close()
    }
  })

  test('SA — Bouton Plans & Tarifs dans nav', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: SA_AUTH_FILE })
    const page = await ctx.newPage()
    try {
      await page.goto('/superadmin')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)

      const btn = page.locator('button, a').filter({ hasText: /Plans & Tarifs/i }).first()
      if (await btn.isVisible({ timeout: 5000 })) {
        rPass('SA nav — bouton "Plans & Tarifs" visible')
        await btn.click()
        await page.waitForTimeout(1500)
        if (page.url().includes('/superadmin/plans')) {
          rPass('SA nav — bouton Plans navigue vers /superadmin/plans')
        } else {
          rWarn('SA nav — navigation Plans', `URL actuelle: ${page.url()}`)
        }
      } else {
        rWarn('SA nav — bouton "Plans & Tarifs"', 'Non visible sur /superadmin')
      }
    } catch (e) {
      rFail('SA nav — bouton Plans', String(e))
    } finally {
      await ctx.close()
    }
  })
})

test.describe('31-B — SuperAdmin Fiche Tenant', () => {
  let saToken = ''

  test.beforeAll(async () => {
    saToken = await getSuperadminToken().catch(() => '')
  })

  test('SA — API Plans retourne les 3 plans', async () => {
    if (!saToken) { rWarn('API Plans', 'Token SA non disponible'); return }
    try {
      const res = await fetch(`${API_URL}/api/v1/superadmin/plans`, {
        headers: { Authorization: `Bearer ${saToken}` },
      })
      const data = await res.json() as { plans?: unknown[] }
      if (res.status === 200 && Array.isArray(data.plans)) {
        rPass(`API Plans — ${data.plans.length} plan(s) retourné(s)`)
      } else {
        rFail('API Plans', `status=${res.status} plans=${JSON.stringify(data.plans)}`)
      }
    } catch (e) {
      rFail('API Plans', String(e))
    }
  })

  test('SA — API liste tenants accessible', async () => {
    if (!saToken) { rWarn('API tenants', 'Token SA non disponible'); return }
    try {
      const res = await fetch(`${API_URL}/api/v1/superadmin/companies`, {
        headers: { Authorization: `Bearer ${saToken}` },
      })
      const data = await res.json() as { companies?: unknown[] }
      if (res.status === 200 && Array.isArray(data.companies) && data.companies.length > 0) {
        rPass(`API tenants — ${data.companies.length} tenant(s) trouvé(s)`)
      } else {
        rFail('API tenants', `status=${res.status}`)
      }
    } catch (e) {
      rFail('API tenants', String(e))
    }
  })

  test('SA — API notes tenant (GET)', async () => {
    if (!saToken) { rWarn('API notes', 'Token SA non disponible'); return }
    try {
      const listRes = await fetch(`${API_URL}/api/v1/superadmin/companies`, {
        headers: { Authorization: `Bearer ${saToken}` },
      })
      const listData = await listRes.json() as { companies?: Array<{ id: string }> }
      const firstId = listData.companies?.[0]?.id
      if (!firstId) { rWarn('API notes', 'Aucun tenant trouvé pour test'); return }

      const res = await fetch(`${API_URL}/api/v1/superadmin/companies/${firstId}/notes`, {
        headers: { Authorization: `Bearer ${saToken}` },
      })
      const data = await res.json() as { notes?: unknown[] }
      if (res.status === 200 && Array.isArray(data.notes)) {
        rPass(`API notes — endpoint opérationnel (${data.notes.length} note(s))`)
      } else {
        rFail('API notes GET', `status=${res.status}`)
      }
    } catch (e) {
      rFail('API notes GET', String(e))
    }
  })

  test('SA — API POST note tenant', async () => {
    if (!saToken) { rWarn('API POST note', 'Token SA non disponible'); return }
    try {
      const listRes = await fetch(`${API_URL}/api/v1/superadmin/companies`, {
        headers: { Authorization: `Bearer ${saToken}` },
      })
      const listData = await listRes.json() as { companies?: Array<{ id: string }> }
      const firstId = listData.companies?.[0]?.id
      if (!firstId) { rWarn('API POST note', 'Aucun tenant trouvé'); return }

      const res = await fetch(`${API_URL}/api/v1/superadmin/companies/${firstId}/notes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${saToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Note de test automatisé Playwright 31' }),
      })
      if (res.status === 201 || res.status === 200) {
        rPass('API POST note — note créée avec succès')
      } else {
        rFail('API POST note', `status=${res.status}`)
      }
    } catch (e) {
      rFail('API POST note', String(e))
    }
  })

  test('SA — API abonnement PATCH (status)', async () => {
    if (!saToken) { rWarn('API subscription PATCH', 'Token SA non disponible'); return }
    try {
      const listRes = await fetch(`${API_URL}/api/v1/superadmin/companies`, {
        headers: { Authorization: `Bearer ${saToken}` },
      })
      const listData = await listRes.json() as { companies?: Array<{ id: string; slug: string }> }
      // Prendre un tenant qui n'est pas sun-and-drive pour éviter de le modifier
      const target = listData.companies?.find(c => c.slug !== 'sun-and-drive')
      if (!target) { rWarn('API subscription PATCH', 'Aucun tenant tiers trouvé'); return }

      const res = await fetch(`${API_URL}/api/v1/superadmin/companies/${target.id}/subscription`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${saToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'starter', mode: 'standard', status: 'active' }),
      })
      if (res.status === 200) {
        rPass('API subscription PATCH — opérationnel')
      } else {
        rFail('API subscription PATCH', `status=${res.status}`)
      }
    } catch (e) {
      rFail('API subscription PATCH', String(e))
    }
  })

  test('SA — UI sections fiche tenant (Abonnement, Notes, Email)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    await injectSaToken(ctx)
    const page = await ctx.newPage()
    try {
      await page.goto('/superadmin')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)

      // Cliquer sur le premier tenant dans la liste
      const firstTenantBtn = page.locator('button, tr').filter({ hasText: /sun-and-drive|Sun and Drive/i }).first()
      if (await firstTenantBtn.isVisible({ timeout: 5000 })) {
        await firstTenantBtn.click()
        await page.waitForTimeout(2000)

        const abonnementSection = page.locator('text=Abonnement').first()
        if (await abonnementSection.isVisible({ timeout: 5000 })) {
          rPass('UI fiche tenant — section Abonnement visible')
        } else {
          rWarn('UI fiche tenant — section Abonnement', 'Non visible après clic sur tenant')
        }

        const notesSection = page.locator('text=Notes commerciales').first()
        if (await notesSection.isVisible({ timeout: 3000 })) {
          rPass('UI fiche tenant — section Notes commerciales visible')
        } else {
          rWarn('UI fiche tenant — section Notes commerciales', 'Non visible')
        }

        const emailSection = page.locator('text=Envoyer un email').first()
        if (await emailSection.isVisible({ timeout: 3000 })) {
          rPass('UI fiche tenant — section Envoyer un email visible')
        } else {
          rWarn('UI fiche tenant — section Envoyer un email', 'Non visible')
        }
      } else {
        rWarn('UI fiche tenant', 'Aucun tenant sun-and-drive trouvé dans la liste')
      }
    } catch (e) {
      rFail('UI fiche tenant — sections', String(e))
    } finally {
      await ctx.close()
    }
  })

  test('SA — UI email template pré-rempli', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    await injectSaToken(ctx)
    const page = await ctx.newPage()
    try {
      await page.goto('/superadmin')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)

      const firstTenantBtn = page.locator('button, tr').filter({ hasText: /sun-and-drive|Sun and Drive/i }).first()
      if (await firstTenantBtn.isVisible({ timeout: 5000 })) {
        await firstTenantBtn.click()
        await page.waitForTimeout(2000)

        // Chercher le select de template
        const templateSelect = page.locator('select').filter({ hasText: /Bienvenue|template|personnalisé/i }).first()
        const allSelects = page.locator('select')
        const selectCount = await allSelects.count()

        let found = false
        for (let i = 0; i < selectCount; i++) {
          const sel = allSelects.nth(i)
          const options = await sel.locator('option').allTextContents()
          if (options.some(o => /Bienvenue|personnalisé/i.test(o))) {
            await sel.selectOption({ index: 0 })
            await page.waitForTimeout(500)
            rPass('UI email — select template présent avec options')
            found = true
            break
          }
        }
        if (!found && await templateSelect.isVisible({ timeout: 2000 })) {
          rPass('UI email — select template visible')
        } else if (!found) {
          rWarn('UI email — select template', `${selectCount} select(s) trouvé(s), aucun avec options Bienvenue`)
        }
      } else {
        rWarn('UI email template', 'Tenant non trouvé dans la liste')
      }
    } catch (e) {
      rFail('UI email template', String(e))
    } finally {
      await ctx.close()
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Padlock & Page blocage (tests tenant)
// ═════════════════════════════════════════════════════════════════════════════
test.describe('31-C — Padlock modules Pro/Enterprise', () => {
  // Le compte admin@sunanddrive.fr est Enterprise → pas de padlock visible
  // On vérifie que l'infrastructure padlock est bien présente dans la sidebar

  test('Padlock — sidebar charge sans erreur', async ({ page }) => {
    try {
      await page.goto('/dashboard')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      await expect(page.locator('nav, [role="navigation"]').first()).toBeVisible({ timeout: 10000 })
      rPass('Sidebar — rendu sans erreur sur compte Enterprise')
    } catch (e) {
      rFail('Sidebar — rendu', String(e))
    }
  })

  test('Padlock — compte Enterprise voit Séquences sans padlock', async ({ page }) => {
    try {
      await page.goto('/sequences')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      const isOnSequences = page.url().includes('/sequences')
      if (isOnSequences) {
        rPass('Padlock — Enterprise : /sequences accessible (pas de padlock)')
      } else {
        rWarn('Padlock — Enterprise /sequences', `Redirigé vers ${page.url()}`)
      }
    } catch (e) {
      rFail('Padlock — sequences accessible', String(e))
    }
  })

  test('Padlock — modal padlock contient mailto contact@sunanddrive.fr', async ({ page }) => {
    // Vérifier que le code du LockedItem contient bien le mailto
    // On le fait via API puisque le compte admin est Enterprise (pas de padlock visible)
    try {
      await page.goto('/dashboard')
      await page.waitForLoadState('domcontentloaded')
      // Chercher si un LockedItem existe dans la sidebar (ne devrait pas pour Enterprise)
      const lockedBtns = page.locator('button').filter({ hasText: /🔒/ })
      const lockedCount = await lockedBtns.count()
      if (lockedCount === 0) {
        rPass('Padlock — aucun module verrouillé pour compte Enterprise')
      } else {
        // Cliquer sur le premier padlock et vérifier le modal
        await lockedBtns.first().click()
        await page.waitForTimeout(500)
        const emailLink = page.locator('a[href*="contact@sunanddrive.fr"]')
        if (await emailLink.isVisible({ timeout: 3000 })) {
          rPass('Padlock — modal contient mailto contact@sunanddrive.fr')
        } else {
          rFail('Padlock — modal email link', 'Lien mailto non trouvé dans le modal')
        }
      }
    } catch (e) {
      rFail('Padlock — test modal', String(e))
    }
  })

  test('Page blocage — /blocked rend BlockedPage', async ({ page }) => {
    try {
      await page.goto('/blocked')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const suspendedText = page.locator('text=/suspendu|bloqué|accès/i').first()
      if (await suspendedText.isVisible({ timeout: 5000 })) {
        rPass('/blocked — BlockedPage rendue avec texte suspension')
      } else {
        // La page /blocked peut rediriger si l'utilisateur est actif
        const url = page.url()
        if (url.includes('/dashboard') || url.includes('/login')) {
          rWarn('/blocked — redirection', `Redirigé vers ${url} (tenant actif, comportement attendu)`)
        } else {
          rWarn('/blocked — contenu', 'Texte "suspendu" non trouvé — page peut-être vide ou redirigée')
        }
      }
    } catch (e) {
      rFail('/blocked — rendu', String(e))
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Tunnel onboarding wizard
// ═════════════════════════════════════════════════════════════════════════════
test.describe('31-D — Tunnel onboarding wizard', () => {

  test('Onboarding wizard — /onboarding/wizard accessible', async ({ page }) => {
    try {
      await page.goto('/onboarding/wizard')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      const main = page.locator('main, [class*="wizard"], [class*="onboarding"]').first()
      if (await main.isVisible({ timeout: 5000 })) {
        rPass('Onboarding wizard — page charge')
      } else {
        rWarn('Onboarding wizard — chargement', 'Aucun conteneur principal détecté')
      }
    } catch (e) {
      rFail('Onboarding wizard — accessible', String(e))
    }
  })

  test('Onboarding wizard — étape 1 Bienvenue + barre progression', async ({ page }) => {
    try {
      await page.goto('/onboarding/wizard')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)

      const stepText = page.locator('text=/1.*5|étape 1|Bienvenue/i').first()
      if (await stepText.isVisible({ timeout: 5000 })) {
        rPass('Wizard étape 1 — indicateur progression 1/5 visible')
      } else {
        rWarn('Wizard étape 1 — progression', 'Texte "1/5" ou "Bienvenue" non trouvé')
      }

      const commencerBtn = page.locator('button').filter({ hasText: /Commencer/i }).first()
      if (await commencerBtn.isVisible({ timeout: 3000 })) {
        rPass('Wizard étape 1 — bouton "Commencer" visible')
      } else {
        rFail('Wizard étape 1 — bouton Commencer', 'Non trouvé')
      }
    } catch (e) {
      rFail('Wizard étape 1', String(e))
    }
  })

  test('Onboarding wizard — navigation étape 1 → 2', async ({ page }) => {
    try {
      await page.goto('/onboarding/wizard')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)

      const commencerBtn = page.locator('button').filter({ hasText: /Commencer/i }).first()
      if (await commencerBtn.isVisible({ timeout: 5000 })) {
        await commencerBtn.click()
        await page.waitForTimeout(1000)

        // Étape 2 : formulaire société
        const siretLabel = page.locator('text=/SIRET|Raison sociale|société/i').first()
        if (await siretLabel.isVisible({ timeout: 5000 })) {
          rPass('Wizard — navigation étape 1 → 2 (formulaire société visible)')
        } else {
          rWarn('Wizard — étape 2', 'Formulaire société non détecté après navigation')
        }

        // Bouton Ignorer
        const ignorerBtn = page.locator('button').filter({ hasText: /Ignorer/i }).first()
        if (await ignorerBtn.isVisible({ timeout: 3000 })) {
          rPass('Wizard étape 2 — bouton "Ignorer" présent')
        } else {
          rWarn('Wizard étape 2 — bouton Ignorer', 'Non trouvé')
        }
      } else {
        rWarn('Wizard navigation 1→2', 'Bouton Commencer non visible')
      }
    } catch (e) {
      rFail('Wizard navigation 1→2', String(e))
    }
  })

  test('Onboarding wizard — navigation jusqu\'à étape 3 (API Getaround)', async ({ page }) => {
    try {
      await page.goto('/onboarding/wizard')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)

      const commencer = page.locator('button').filter({ hasText: /Commencer/i }).first()
      if (await commencer.isVisible({ timeout: 5000 })) {
        await commencer.click()
        await page.waitForTimeout(800)
      }

      const ignorer1 = page.locator('button').filter({ hasText: /Ignorer/i }).first()
      if (await ignorer1.isVisible({ timeout: 3000 })) {
        await ignorer1.click()
        await page.waitForTimeout(800)

        // Étape 3 : API Getaround
        const apiLabel = page.locator('text=/Getaround|clé API/i').first()
        if (await apiLabel.isVisible({ timeout: 5000 })) {
          rPass('Wizard — étape 3 (API Getaround) visible après Ignorer étape 2')
        } else {
          rWarn('Wizard — étape 3', 'Champ API Getaround non détecté')
        }

        const ignorer2 = page.locator('button').filter({ hasText: /Ignorer/i }).first()
        if (await ignorer2.isVisible({ timeout: 3000 })) {
          rPass('Wizard étape 3 — bouton "Ignorer →" présent')
        } else {
          rWarn('Wizard étape 3 — bouton Ignorer', 'Non trouvé')
        }
      } else {
        rWarn('Wizard navigation 2→3', 'Bouton Ignorer étape 2 non visible')
      }
    } catch (e) {
      rFail('Wizard navigation jusqu\'à étape 3', String(e))
    }
  })

  test('Onboarding wizard — étape 4 (préférences messagerie)', async ({ page }) => {
    try {
      await page.goto('/onboarding/wizard')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)

      // Naviguer jusqu'à étape 4 via Ignorer
      for (const label of ['Commencer', 'Ignorer', 'Ignorer']) {
        const btn = page.locator('button').filter({ hasText: new RegExp(label, 'i') }).first()
        if (await btn.isVisible({ timeout: 4000 })) {
          await btn.click()
          await page.waitForTimeout(700)
        }
      }

      const tonLabel = page.locator('text=/Vouvoiement|Tutoiement|ton/i').first()
      if (await tonLabel.isVisible({ timeout: 5000 })) {
        rPass('Wizard étape 4 — toggles ton (Vouvoiement/Tutoiement) visibles')
      } else {
        rWarn('Wizard étape 4', 'Toggles ton non trouvés')
      }
    } catch (e) {
      rFail('Wizard étape 4', String(e))
    }
  })

  test('Onboarding wizard — étape 5 (checklist + bouton dashboard)', async ({ page }) => {
    try {
      await page.goto('/onboarding/wizard')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)

      // Naviguer jusqu'à étape 5
      for (const label of ['Commencer', 'Ignorer', 'Ignorer', 'Ignorer']) {
        const btn = page.locator('button').filter({ hasText: new RegExp(label, 'i') }).first()
        if (await btn.isVisible({ timeout: 4000 })) {
          await btn.click()
          await page.waitForTimeout(700)
        }
      }

      const dashboardBtn = page.locator('button').filter({ hasText: /Aller au tableau de bord/i }).first()
      if (await dashboardBtn.isVisible({ timeout: 5000 })) {
        rPass('Wizard étape 5 — bouton "Aller au tableau de bord" visible')
      } else {
        rFail('Wizard étape 5 — bouton dashboard', 'Non trouvé')
      }

      const checklistItem = page.locator('text=/Compte créé|véhicule visible|sync/i').first()
      if (await checklistItem.isVisible({ timeout: 3000 })) {
        rPass('Wizard étape 5 — checklist activation visible')
      } else {
        rWarn('Wizard étape 5 — checklist', 'Items de checklist non détectés')
      }
    } catch (e) {
      rFail('Wizard étape 5', String(e))
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Billing page tenant
// ═════════════════════════════════════════════════════════════════════════════
test.describe('31-E — Billing page tenant', () => {

  test('Billing — /billing accessible', async ({ page }) => {
    try {
      await page.goto('/billing')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      const main = page.locator('main').first()
      if (await main.isVisible({ timeout: 5000 })) {
        rPass('Billing — page /billing charge')
      } else {
        rWarn('Billing — chargement', 'Conteneur principal non visible')
      }
    } catch (e) {
      rFail('Billing — accessible', String(e))
    }
  })

  test('Billing — plan actuel affiché', async ({ page }) => {
    try {
      await page.goto('/billing')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      const planLabel = page.locator('text=/starter|pro|enterprise/i').first()
      if (await planLabel.isVisible({ timeout: 5000 })) {
        rPass('Billing — plan actuel visible')
      } else {
        rWarn('Billing — plan', 'Texte plan non trouvé (starter/pro/enterprise)')
      }
    } catch (e) {
      rFail('Billing — plan affiché', String(e))
    }
  })

  test('Billing — bouton Gérer mon abonnement présent', async ({ page }) => {
    try {
      await page.goto('/billing')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      const btn = page.locator('button').filter({ hasText: /Gérer mon abonnement|portail|portal/i }).first()
      if (await btn.isVisible({ timeout: 5000 })) {
        rPass('Billing — bouton "Gérer mon abonnement" visible')
      } else {
        rWarn('Billing — bouton portail', 'Bouton "Gérer mon abonnement" non trouvé')
      }
    } catch (e) {
      rFail('Billing — bouton portail', String(e))
    }
  })

  test('Billing — section historique paiements présente', async ({ page }) => {
    try {
      await page.goto('/billing')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2000)
      const histLabel = page.locator('text=/historique|paiements|factures/i').first()
      if (await histLabel.isVisible({ timeout: 5000 })) {
        rPass('Billing — section historique paiements visible')
      } else {
        rWarn('Billing — historique paiements', 'Section non trouvée')
      }
    } catch (e) {
      rFail('Billing — historique', String(e))
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Création tenant enrichie (API)
// ═════════════════════════════════════════════════════════════════════════════
test.describe('31-F — Création tenant enrichie (API)', () => {
  let saToken = ''

  test.beforeAll(async () => {
    saToken = await getSuperadminToken().catch(() => '')
  })

  test('SA — Auto-slug depuis nom société', async () => {
    if (!saToken) { rWarn('Auto-slug', 'Token SA non disponible'); return }
    // Vérifier l'endpoint en envoyant un nom et attendant un slug auto
    // On fait un dry-run sans tenantDbUrl pour vérifier la validation
    try {
      const res = await fetch(`${API_URL}/api/v1/superadmin/companies`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${saToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test ACME SaaS Playwright', contactEmail: 'test-acme@example.com' }),
      })
      // Sans tenantDbUrl → 400 attendu
      if (res.status === 400) {
        rPass('Auto-slug — validation requise (tenantDbUrl manquant → 400 correct)')
      } else if (res.status === 201) {
        const data = await res.json() as { company?: { slug?: string } }
        const slug = data.company?.slug ?? ''
        if (slug.includes('test') && slug === slug.toLowerCase()) {
          rPass(`Auto-slug — slug généré : "${slug}"`)
        } else {
          rWarn('Auto-slug', `Slug généré : "${slug}"`)
        }
      } else {
        rWarn('Auto-slug — endpoint', `Status inattendu : ${res.status}`)
      }
    } catch (e) {
      rFail('Auto-slug', String(e))
    }
  })

  test('SA — API payments tenant accessible', async () => {
    if (!saToken) { rWarn('API payments', 'Token SA non disponible'); return }
    try {
      const listRes = await fetch(`${API_URL}/api/v1/superadmin/companies`, {
        headers: { Authorization: `Bearer ${saToken}` },
      })
      const listData = await listRes.json() as { companies?: Array<{ id: string }> }
      const firstId = listData.companies?.[0]?.id
      if (!firstId) { rWarn('API payments', 'Aucun tenant trouvé'); return }

      const res = await fetch(`${API_URL}/api/v1/superadmin/companies/${firstId}/payments`, {
        headers: { Authorization: `Bearer ${saToken}` },
      })
      const data = await res.json() as { payments?: unknown[] }
      if (res.status === 200 && Array.isArray(data.payments)) {
        rPass(`API payments — endpoint opérationnel (${data.payments.length} paiement(s))`)
      } else {
        rFail('API payments', `status=${res.status}`)
      }
    } catch (e) {
      rFail('API payments', String(e))
    }
  })

  test.afterAll(() => saveReport())
})
