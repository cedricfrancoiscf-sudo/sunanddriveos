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
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    }
  ]
})
