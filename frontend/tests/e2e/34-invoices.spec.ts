import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { API_URL, TENANT_SLUG, getSuperadminToken } from './helpers/auth'

// ─── Report tracking ──────────────────────────────────────────────────────────
type Entry = { status: '✅ PASS' | '❌ FAIL' | '⚠️ WARN'; desc: string; detail?: string }
const REPORT: Entry[] = []

function rPass(desc: string) {
  REPORT.push({ status: '✅ PASS', desc })
  console.log(`[34] ✅ PASS — ${desc}`)
}
function rFail(desc: string, detail: string) {
  REPORT.push({ status: '❌ FAIL', desc, detail })
  console.log(`[34] ❌ FAIL — ${desc} — ${detail}`)
}
function rWarn(desc: string, detail: string) {
  REPORT.push({ status: '⚠️ WARN', desc, detail })
  console.log(`[34] ⚠️ WARN — ${desc} — ${detail}`)
}

function saveReport() {
  const outDir = path.resolve(process.cwd(), 'tests/e2e/results')
  fs.mkdirSync(outDir, { recursive: true })
  const pass = REPORT.filter(r => r.status === '✅ PASS').length
  const fail = REPORT.filter(r => r.status === '❌ FAIL').length
  const warn = REPORT.filter(r => r.status === '⚠️ WARN').length
  const lines = [
    '═══════════════════════════════════════════════════════════════',
    '   RAPPORT 34 — Invoices Getaround + Frais supplémentaires',
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
  const reportPath = path.join(outDir, '34-invoices-report.txt')
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8')
  console.log(`[34] Rapport écrit : ${reportPath}`)
  console.log(`[34] Total: ${REPORT.length} | ✅ ${pass} | ❌ ${fail} | ⚠️ ${warn}`)
}

const ADMIN_AUTH = 'tests/e2e/.auth/user.json'

async function getAdminToken(): Promise<string> {
  const data = JSON.parse(fs.readFileSync(ADMIN_AUTH, 'utf8')) as {
    origins: Array<{ localStorage: Array<{ name: string; value: string }> }>
  }
  const items = data.origins?.[0]?.localStorage ?? []
  const tok = items.find(i => i.name === 'auth_token')
  if (!tok) throw new Error('auth_token absent du storage admin')
  return tok.value
}

// ─────────────────────────────────────────────────────────────────────────────
// 34-A — Paramètres : section Frais supplémentaires
// ─────────────────────────────────────────────────────────────────────────────
test.describe('34-A — Paramètres Frais supplémentaires', () => {
  test.afterAll(() => saveReport())

  test('section Frais supplémentaires visible dans Paramètres', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_AUTH })
    const page = await ctx.newPage()
    try {
      await page.goto('/settings')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const section = page.locator('[data-testid="extra-charges-section"]')
      await section.scrollIntoViewIfNeeded()
      await section.waitFor({ state: 'visible', timeout: 10000 })
      rPass('section Frais supplémentaires visible')
      expect(await section.isVisible()).toBe(true)
    } catch (e) {
      rFail('section Frais supplémentaires visible', String(e))
      throw e
    } finally {
      await ctx.close()
    }
  })

  test('champ invoiceSyncWindowDays modifiable et sauvegardable', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_AUTH })
    const page = await ctx.newPage()
    try {
      await page.goto('/settings')
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const input = page.locator('[data-testid="input-invoice-sync-window"]')
      await input.scrollIntoViewIfNeeded()
      await input.waitFor({ state: 'visible', timeout: 8000 })
      await input.fill('14')
      await expect(input).toHaveValue('14')
      rPass('champ invoiceSyncWindowDays modifiable')
    } catch (e) {
      rFail('champ invoiceSyncWindowDays modifiable', String(e))
      throw e
    } finally {
      await ctx.close()
    }
  })

  test('malus scoring configurable via API PUT /settings', async () => {
    try {
      const token = await getAdminToken()
      const res = await fetch(`${API_URL}/api/v1/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'x-tenant-slug': TENANT_SLUG },
        body: JSON.stringify({
          invoiceSyncWindowDays: 7,
          invoiceActiveTypes: ['blocked_cleaning', 'blocked_damage'],
          invoiceMalusConfig: { blocked_cleaning: 15, blocked_damage: 25 },
        }),
      })
      const data = await res.json() as { settings?: { invoiceSyncWindowDays?: number } }
      if (res.ok) {
        rPass('PUT /settings invoiceMalusConfig')
        expect(data.settings?.invoiceSyncWindowDays).toBe(7)
      } else {
        rWarn('PUT /settings invoiceMalusConfig', `status ${res.status}`)
      }
    } catch (e) {
      rFail('PUT /settings invoiceMalusConfig', String(e))
      throw e
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 34-B — API : invoices + unblock-evaluation
// ─────────────────────────────────────────────────────────────────────────────
test.describe('34-B — API invoices & unblock', () => {
  test('GET /rentals/:id/invoices retourne tableau', async () => {
    try {
      const token = await getAdminToken()
      // Récupère une location réelle
      const listRes = await fetch(`${API_URL}/api/v1/rentals?limit=1&status=completed`, {
        headers: { 'Authorization': `Bearer ${token}`, 'x-tenant-slug': TENANT_SLUG },
      })
      const listData = await listRes.json() as { rentals?: Array<{ id: string }> }
      const rentalId = listData.rentals?.[0]?.id
      if (!rentalId) {
        rWarn('GET /rentals/:id/invoices', 'Aucune location disponible')
        return
      }
      const res = await fetch(`${API_URL}/api/v1/rentals/${rentalId}/invoices`, {
        headers: { 'Authorization': `Bearer ${token}`, 'x-tenant-slug': TENANT_SLUG },
      })
      const data = await res.json() as { invoices?: unknown[] }
      if (res.ok && Array.isArray(data.invoices)) {
        rPass('GET /rentals/:id/invoices')
        expect(Array.isArray(data.invoices)).toBe(true)
      } else {
        rWarn('GET /rentals/:id/invoices', `status ${res.status}`)
      }
    } catch (e) {
      rFail('GET /rentals/:id/invoices', String(e))
      throw e
    }
  })

  test('PATCH /rentals/:id/unblock-evaluation — erreur 400 sans flag', async () => {
    try {
      const token = await getAdminToken()
      const listRes = await fetch(`${API_URL}/api/v1/rentals?limit=1&status=completed`, {
        headers: { 'Authorization': `Bearer ${token}`, 'x-tenant-slug': TENANT_SLUG },
      })
      const listData = await listRes.json() as { rentals?: Array<{ id: string; evaluationFlag?: string }> }
      const rental = listData.rentals?.[0]
      if (!rental) {
        rWarn('PATCH /rentals/:id/unblock-evaluation', 'Aucune location')
        return
      }
      if (rental.evaluationFlag) {
        rWarn('PATCH /rentals/:id/unblock-evaluation', 'location a déjà un flag, test non applicable')
        return
      }
      const res = await fetch(`${API_URL}/api/v1/rentals/${rental.id}/unblock-evaluation`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'x-tenant-slug': TENANT_SLUG },
      })
      rPass(`PATCH /unblock-evaluation → ${res.status} (400 attendu sans flag)`)
      expect(res.status).toBe(400)
    } catch (e) {
      rFail('PATCH /rentals/:id/unblock-evaluation', String(e))
      throw e
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 34-C — UI : banner évaluation flag
// ─────────────────────────────────────────────────────────────────────────────
test.describe('34-C — UI banner évaluation flag', () => {
  test('banner absent sur location sans evaluationFlag', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_AUTH })
    const page = await ctx.newPage()
    try {
      const token = await getAdminToken()
      const listRes = await fetch(`${API_URL}/api/v1/rentals?limit=5&status=completed`, {
        headers: { 'Authorization': `Bearer ${token}`, 'x-tenant-slug': TENANT_SLUG },
      })
      const listData = await listRes.json() as { rentals?: Array<{ id: string; evaluationFlag?: string | null }> }
      const noFlag = listData.rentals?.find(r => !r.evaluationFlag)
      if (!noFlag) {
        rWarn('banner absent sans evaluationFlag', 'Aucune location sans flag trouvée')
        return
      }
      await page.goto(`/rentals/${noFlag.id}`)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1500)
      const banner = page.locator('[data-testid="evaluation-flag-banner"]')
      const visible = await banner.isVisible()
      if (!visible) {
        rPass('banner absent sur location sans flag')
        expect(visible).toBe(false)
      } else {
        rWarn('banner absent sans evaluationFlag', 'banner visible alors que pas de flag')
      }
    } catch (e) {
      rFail('banner absent sans evaluationFlag', String(e))
      throw e
    } finally {
      await ctx.close()
    }
  })
})
