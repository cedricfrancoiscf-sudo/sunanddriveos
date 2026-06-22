import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

dotenv.config({ path: new URL('.env.test', import.meta.url).pathname })

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: process.env.BASE_URL || 'https://appli.sunanddrive.com',
    headless: false,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  timeout: 30000,
  retries: 1,
  reporter: [['html', { outputFolder: 'playwright-report' }]],
  projects: [
    {
      name: 'setup',
      testMatch: '**/helpers/setup.ts',
    },
    {
      name: 'superadmin-setup',
      testMatch: '**/helpers/superadmin-setup.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Start from user storageState so auth_token is already present;
        // superadmin-setup then injects superadmin_token on top.
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup'],
      // Exclude files that belong to the dedicated superadmin project
      testIgnore: ['**/33-superadmin-stripe.spec.ts'],
    },
    {
      name: 'superadmin',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/superadmin.json',
      },
      dependencies: ['superadmin-setup'],
      testMatch: ['**/33-superadmin-stripe.spec.ts'],
    },
  ],
})
