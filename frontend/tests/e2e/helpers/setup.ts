import { test as setup } from '@playwright/test'
import { login } from './auth'

setup('authenticate', async ({ page }) => {
  await login(page)
  await page.context().storageState({
    path: 'tests/e2e/.auth/user.json'
  })
})
