import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/intelligence')
  await page.waitForTimeout(3000)
})

test('Intelligence — Page charge sans blanchir', async ({ page }) => {
  await expect(page.locator('main').getByText(/CA mensuel/).first()).toBeVisible()
  await page.waitForTimeout(3000)
  await expect(page.locator('main').getByText(/CA mensuel/).first()).toBeVisible()
})

test('Intelligence — Histogramme visible', async ({ page }) => {
  await expect(page.locator('.recharts-wrapper, svg').first()).toBeVisible()
})

test('Intelligence — Tooltip au survol', async ({ page }) => {
  const bar = page.locator('.recharts-bar-rectangle').first()
  if (await bar.isVisible()) {
    await bar.hover()
    await expect(page.locator('main').getByText('Location').first()).toBeVisible()
  }
})

test('Intelligence — Taux occupation ≤ 100%', async ({ page }) => {
  await page.locator('main').getByText('Occupation').first().click()
  await page.waitForTimeout(1000)
  const labels = await page.locator('.recharts-label').filter({ hasText: /10[1-9]%|1[1-9][0-9]%/ }).count()
  expect(labels).toBe(0)
})

test('Intelligence — Suggestions IA visibles', async ({ page }) => {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(page.locator('main').getByText(/Suggestions IA/).first()).toBeVisible({ timeout: 15000 })
})

test('Intelligence — Chat IA répond', async ({ page }) => {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const input = page.locator('input[placeholder*="question"], textarea[placeholder*="question"]')
  if (await input.isVisible()) {
    await input.fill('Quelle est ma voiture la plus rentable ?')
    await page.getByRole('button', { name: 'Envoyer' }).click()
    await expect(page.locator('.ai-response, .message-ai')).toBeVisible({ timeout: 30000 })
  }
})
