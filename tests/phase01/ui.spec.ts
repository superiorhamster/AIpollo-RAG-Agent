import { expect, test, type Page } from '@playwright/test'

const workspace = '33333333-3333-4333-8333-333333333333'
class WorkspacePage {
  constructor(readonly page: Page) {}
  async open() {
    await this.page.context().addCookies([{ name: 'rag_access', value: 'ui-fixture-only', domain: '127.0.0.1', path: '/' }])
    await this.page.goto('/workspaces/' + workspace)
    await expect(this.page.getByRole('region', { name: 'Workspace assistant' })).toBeVisible()
  }
  async ask() {
    const assistant = this.page.getByRole('region', { name: 'Workspace assistant' })
    await this.page.getByRole('checkbox', { name: 'ready.pdf', exact: true }).check()
    await assistant.getByLabel('Question or objective').fill('Where is the demo?')
    await assistant.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(assistant.getByRole('button', { name: 'ready.pdf, page 2' })).toBeVisible()
    return assistant
  }
}

test.beforeAll(async ({ browser, request }) => {
  const page = await browser.newPage()
  await page.setContent('<style>section{break-after:page;height:600px}</style><section>Page one</section><section>Page two: B4-201</section><section>Page three</section>')
  const pdf = await page.pdf({ format: 'A4' })
  await request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/pdf', { data: pdf })
  await page.close()
})

test('registration confirmation, success notice and language persist across public pages', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Tiếng Việt', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Đăng nhập', exact: true })).toBeVisible()
  await page.goto('/register')
  await expect(page.getByRole('heading', { name: 'Tạo tài khoản', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill('ui-fixture@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Fixture12!')
  await page.getByLabel('Confirm password', { exact: true }).fill('Mismatch12!')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByText('Passwords do not match.', { exact: true })).toBeVisible()
  await page.getByLabel('Confirm password', { exact: true }).fill('Fixture12!')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Account created. Sign in to continue.')
})

test('throttling uses Retry-After and disables repeated sign-in attempts', async ({ page }) => {
  await page.route('**/v1/auth/login', route => route.fulfill({ status: 429, headers: { 'Retry-After': '30', 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'throttled', message: 'Too many attempts.' }) }))
  await page.goto('/sign-in')
  await page.getByLabel('Email', { exact: true }).fill('ui-fixture@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Fixture12!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('Try again in')
})

test('PDF page jump, horizontal zoom scrolling and clearing citation highlight', async ({ page }) => {
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  const assistant = await workspacePage.ask()
  await assistant.getByRole('button', { name: 'ready.pdf, page 2' }).click()
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toBeVisible()
  await expect(page.getByLabel('Citation highlight')).toBeVisible()
  await page.getByRole('button', { name: 'Clear highlight', exact: true }).click()
  await expect(page.getByLabel('Citation highlight')).toHaveCount(0)
  await page.getByRole('spinbutton', { name: 'Page number' }).fill('3')
  await page.getByRole('button', { name: 'Go', exact: true }).click()
  await expect(page.getByRole('img', { name: 'PDF page 3', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const paper = page.getByRole('region', { name: 'Scrollable PDF page' })
  await expect.poll(() => paper.evaluate(el => el.scrollWidth > el.clientWidth)).toBeTruthy()
  await paper.evaluate(el => { el.scrollLeft = el.scrollWidth })
  await expect.poll(() => paper.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
})

test('saved response opens the exact artifact', async ({ page }) => {
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  const assistant = await workspacePage.ask()
  await assistant.getByText('Save as artifact', { exact: true }).click()
  await assistant.getByRole('textbox', { name: 'Shared artifact name' }).fill('Saved fixture')
  await assistant.getByRole('button', { name: 'Save artifact', exact: true }).click()
  await assistant.getByRole('button', { name: 'Open artifact', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Artifact name', exact: true })).toHaveValue('Saved fixture')
})

test('mobile chat scroll area does not sit underneath the composer', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  await page.getByText('Choose sources', { exact: true }).click()
  const assistant = await workspacePage.ask()
  const citation = assistant.getByRole('button', { name: 'ready.pdf, page 2' })
  await citation.scrollIntoViewIfNeeded()
  const claim = await citation.boundingBox()
  const input = await assistant.getByRole('textbox', { name: 'Question or objective' }).boundingBox()
  expect(claim!.y + claim!.height).toBeLessThanOrEqual(input!.y)
  await citation.click()
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toBeVisible()
  const toolbar = await page.getByRole('spinbutton', { name: 'Page number' }).boundingBox()
  expect(toolbar!.height).toBeGreaterThan(20)
  await page.screenshot({ path: 'test-results/ui-mobile-reader.png' })
})


test('preview readiness is separate from queued AI indexing', async ({ page }) => {
  await page.route('**/documents/*/jobs', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ kind: 'index', status: 'queued', attempts: 0, error_code: null }]) }))
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: 'ready.pdf' })
  await expect(row.getByText('Ready to view', { exact: true })).toBeVisible()
  await expect(row.getByText('Queued', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'ready.pdf', exact: true })).toBeDisabled()
  await row.getByRole('button', { name: 'Open ready.pdf' }).click()
  await expect(page.getByRole('img', { name: 'PDF page 1', exact: true })).toBeVisible()
})

test('status polling reports transient failure and recovers with backoff', async ({ page }) => {
  let attempts = 0
  await page.route('**/documents/*/jobs', async route => {
    if (++attempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable' }) })
    return route.continue()
  })
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await expect(page.getByText('Could not update document status. Retrying with backoff.', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'ready.pdf', exact: true })).toBeEnabled({ timeout: 10000 })
  await expect(page.getByText('Could not update document status. Retrying with backoff.', { exact: true })).toHaveCount(0)
})
