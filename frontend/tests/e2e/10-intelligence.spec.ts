import { test, expect } from '@playwright/test'
import { login } from './helpers/auth'

test.beforeEach(async ({ page }) => {
  await login(page)
  await page.goto('/intelligence')
  await page.waitForTimeout(3000)
})

test('Intelligence — Page charge sans blanchir', async ({ page }) => {
  await expect(page.locator('text=CA mensuel')).toBeVisible()
  await page.waitForTimeout(3000)
  await expect(page.locator('text=CA mensuel')).toBeVisible()
})

test('Intelligence — Histogramme visible', async ({ page }) => {
  await expect(page.locator('.recharts-wrapper, svg')).toBeVisible()
})

test('Intelligence — Tooltip au survol', async ({ page }) => {
  const bar = page.locator('.recharts-bar-rectangle').first()
  if (await bar.isVisible()) {
    await bar.hover()
    await expect(page.locator('text=Location')).toBeVisible()
  }
})

test('Intelligence — Taux occupation ≤ 100%', async ({ page }) => {
  await page.click('text=Occupation')
  await page.waitForTimeout(1000)
  const labels = await page.locator('.recharts-label, text=/10[1-9]%|1[1-9][0-9]%/').count()
  expect(labels).toBe(0)
})

test('Intelligence — Suggestions IA visibles', async ({ page }) => {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(page.locator('text=Suggestion, text=suggestion')).toBeVisible({ timeout: 15000 })
})

test('Intelligence — Chat IA répond', async ({ page }) => {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const input = page.locator('input[placeholder*="question"], textarea[placeholder*="question"]')
  if (await input.isVisible()) {
    await input.fill('Quelle est ma voiture la plus rentable ?')
    await page.click('button:has-text("Envoyer")')
    await expect(page.locator('.ai-response, .message-ai')).toBeVisible({ timeout: 30000 })
  }
})
