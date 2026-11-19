import { defineConfig } from '@playwright/test'

const baseURL = process.env.PHASE01_TEST_ORIGIN ?? 'http://127.0.0.1:3000'

export default defineConfig({
  testMatch: 'workspace.spec.ts',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL,
    browserName: 'chromium',
    actionTimeout: 8000,
    navigationTimeout: 15000,
  },
})
