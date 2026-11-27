import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const remote = process.env.UI_TEST_REMOTE === '1'
export default defineConfig({
  testMatch: ['ui.spec.ts', 'live-session.spec.ts'],
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: process.env.PHASE01_TEST_ORIGIN ?? 'http://127.0.0.1:24000',
    channel: process.env.UI_TEST_BROWSER_CHANNEL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: remote ? undefined : [
    { command: 'node tests/phase01/ui-gateway.mjs', cwd: root, url: 'http://127.0.0.1:24001/healthz' },
    { command: 'node apps/web/node_modules/next/dist/bin/next start apps/web --port 24000 --hostname 127.0.0.1',
      cwd: root, url: 'http://127.0.0.1:24000/healthz', timeout: 120000,
      env: { API_GATEWAY_URL: 'http://127.0.0.1:24001', WEB_ORIGIN: 'http://127.0.0.1:24000' } },
  ],
})
