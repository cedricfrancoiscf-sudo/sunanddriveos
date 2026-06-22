import { test as setup } from '@playwright/test'
import { getSuperadminToken } from './auth'

setup('authenticate superadmin', async ({ page }) => {
  // Get superadmin token via API (credentials: admin@sunanddriveos.com / ChangeMe2024!)
  const saToken = await getSuperadminToken()

  // Navigate to the superadmin app and inject the token into localStorage.
  // The page already has auth_token from user.json storageState (loaded via project dependency),
  // so navigating to /superadmin and injecting superadmin_token gives us both tokens.
  await page.goto('/superadmin')
  await page.evaluate((token: string) => {
    localStorage.setItem('superadmin_token', token)
  }, saToken)
  await page.reload()
  await page.waitForTimeout(1000)

  await page.context().storageState({
    path: 'tests/e2e/.auth/superadmin.json',
  })
})
