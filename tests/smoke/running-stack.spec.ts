import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { expect, test, type Page, type APIResponse } from '@playwright/test'

type Run = { run_id: string; status: string; error_code?: string; retryable?: boolean; result?: { claims: { text: string; citations: { document_id: string; page: number }[] }[] } }
class SmokeUser {
  constructor(readonly page: Page) {}
  async registerAndSignIn() {
    const email = `smoke-${randomUUID()}@example.com`
    const password = 'SmokeTest12!'
    await this.page.goto('/register')
    await this.page.getByLabel('Email').fill(email)
    await this.page.getByLabel('Password', { exact: true }).fill(password)
    await this.page.getByLabel('Confirm password', { exact: true }).fill(password)
    await this.page.getByRole('button', { name: 'Create account', exact: true }).click()
    await expect(this.page).toHaveURL(/\/sign-in\?registered=1$/)
    await this.page.getByLabel('Email').fill(email)
    await this.page.getByLabel('Password', { exact: true }).fill(password)
    await this.page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(this.page).toHaveURL(/\/workspaces$/)
  }
  async createWorkspace() {
    const created = this.page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/v1/workspaces')
    await this.page.getByRole('textbox', { name: 'Workspace name' }).fill('Synthetic running-stack smoke')
    await this.page.getByRole('button', { name: 'Create workspace', exact: true }).click()
    const response = await created
    expect(response.status()).toBe(201)
    const workspace = (await response.json()).workspace_id as string
    return workspace
  }
}

test('running stack: identity, sources, approval, grounded Ask and cleanup', async ({ page, context, baseURL, request }) => {
  test.setTimeout(720000)
  const origin = baseURL!
  const report: { origin: string; stages: Record<string, string>; ai_error_code?: string; page_errors: number } = { origin, stages: {}, page_errors: 0 }
  page.on('pageerror', () => { report.page_errors += 1 })
  const keyHeaders = () => ({ Origin: origin, 'Idempotency-Key': randomUUID() })
  async function session(send: () => Promise<APIResponse>) {
    let response = await send()
    if (response.status() === 401) {
      expect((await page.request.post('/v1/auth/refresh', { headers: { Origin: origin } })).status()).toBe(204)
      response = await send()
    }
    return response
  }
  let workspace: string | undefined
  let ai: Run | undefined
  try {
    await page.goto('/workspaces')
    await expect(page).toHaveURL(/\/sign-in$/)
    expect((await page.request.post('/v1/auth/refresh')).status()).toBe(403)
    expect((await page.request.post('/v1/auth/refresh', { headers: { Origin: origin } })).status()).toBe(401)
    report.stages.origin_and_anonymous_access = 'passed'
    const pdfPage = await context.newPage()
    await pdfPage.setContent('<meta charset="utf-8"><h1>Synthetic Smoke Source</h1><p>The research demo starts at 14:00 on Friday in room B4-201.</p><p>Registration closes 30 minutes before the demo. Bring an HDMI to VGA adapter.</p>')
    const pdf = await pdfPage.pdf({ format: 'A4' })
    await pdfPage.close()
    const user = new SmokeUser(page)
    await user.registerAndSignIn()
    report.stages.registration_and_login = 'passed'
    await context.clearCookies({ name: 'rag_access' })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()
    report.stages.session_renewal = 'passed'
    workspace = await user.createWorkspace()
    await page.getByRole('article', { name: 'Synthetic running-stack smoke', exact: true }).getByRole('link', { name: 'Documents', exact: true }).click()
    const base = '/v1/workspaces/' + workspace
    expect((await request.get(base + '/documents')).status()).toBe(401)
    report.stages.protected_api = 'passed'
    await expect(page).toHaveURL(new RegExp('/workspaces/' + workspace))
    const uploaded = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === base + '/documents')
    await page.getByLabel('Document file').setInputFiles({ name: 'smoke-source.pdf', mimeType: 'application/pdf', buffer: pdf })
    await page.getByRole('button', { name: 'Upload document', exact: true }).click()
    const upload = await uploaded
    expect(upload.status()).toBe(201)
    const document = (await upload.json()).document_id as string
    report.stages.workspace_and_upload = 'passed'
    await expect.poll(async () => {
      const r = await session(() => page.request.get(base + `/documents/${document}/jobs`))
      if (r.status() === 503) return 'unavailable'
      expect(r.status()).toBe(200)
      return (await r.json() as { kind: string; status: string }[]).find(j => j.kind === 'index')?.status
    }, { timeout: 450000, intervals: [2000, 4000] }).toBe('succeeded')
    report.stages.parsing_and_indexing = 'passed'
    const searchHeaders = keyHeaders()
    const search = await session(() => page.request.post(base + '/search', { headers: searchHeaders, data: { query: 'What room hosts the research demo?', document_ids: [document], limit: 6 }, timeout: 135000 }))
    expect(search.status()).toBe(200)
    const evidence = (await search.json()).evidence as { document_id: string; page: number }[]
    expect(evidence.length).toBeGreaterThan(0)
    expect(evidence.every(e => e.document_id === document && e.page >= 1)).toBe(true)
    report.stages.scoped_search = 'passed'
    const objective = { query: 'Explain when and where the demo takes place.', capability: 'LEARN', task: 'answer', document_ids: [document] }
    const plan = await page.request.post(base + '/plans', { headers: keyHeaders(), data: objective })
    expect(plan.status()).toBe(201)
    const planned = await plan.json()
    const planPath = base + '/plans/' + planned.plan_id
    const unaccepted = await page.request.post(base + '/runs', { headers: keyHeaders(), data: { mode: 'PLAN', plan_id: planned.plan_id, plan_version: 1 } })
    expect(unaccepted.status()).toBe(409)
    const acceptance = keyHeaders()
    for (let i = 0; i < 2; i++) expect((await page.request.post(planPath + '/accept', { headers: acceptance, data: { plan_version: 1 } })).status()).toBe(200)
    const revised = await page.request.patch(planPath, { headers: keyHeaders(), data: { ...objective, query: 'Explain the registration deadline.', expected_version: 1 } })
    expect(revised.status()).toBe(200)
    expect((await revised.json()).plan_version).toBe(2)
    expect((await page.request.post(base + '/runs', { headers: keyHeaders(), data: { mode: 'PLAN', plan_id: planned.plan_id, plan_version: 1 } })).status()).toBe(409)
    report.stages.plan_acceptance_and_stale_version = 'passed'
    await page.goto(`/workspaces/${workspace}?document=${document}&page=1`)
    await expect(page.getByRole('img', { name: 'PDF page 1', exact: true })).toBeVisible({ timeout: 30000 })
    report.stages.pdf_reader = 'passed'
    await page.goto('/workspaces/' + workspace)
    await expect(page).not.toHaveURL(/document=/)
    await page.getByRole('button', { name: 'Chats', exact: true }).click()
    await page.getByRole('checkbox', { name: 'smoke-source.pdf', exact: true }).check()
    const submitted = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === base + '/runs')
    const assistant = page.getByRole('region', { name: 'Workspace assistant' })
    await assistant.getByRole('textbox', { name: 'Question or objective' }).fill('What room hosts the research demo?')
    await assistant.getByRole('button', { name: 'Send', exact: true }).click()
    const started = await submitted
    expect(started.status()).toBe(202)
    const run = (await started.json()).run_id as string
    await expect.poll(async () => {
      const r = await session(() => page.request.get(base + '/runs/' + run))
      if (r.status() === 503) return false
      expect(r.status()).toBe(200)
      ai = await r.json()
      return ai && ['succeeded', 'failed', 'cancelled'].includes(ai.status)
    }, { timeout: 240000, intervals: [1000, 2000] }).toBeTruthy()
    report.stages.grounded_ask = 'failed'
    report.ai_error_code = ai?.error_code ?? undefined
    if (ai?.status === 'succeeded') {
      expect(ai.result?.claims.some(c => /B4-201/.test(c.text))).toBe(true)
      expect(ai.result?.claims.every(c => c.citations.length > 0 && c.citations.every(s => s.document_id === document && s.page === 1))).toBe(true)
      report.stages.grounded_ask = 'passed'
      // All citations use the same one-page fixture; any supported claim may open that page.
      await assistant.getByRole('button', { name: 'smoke-source.pdf, page 1', exact: true }).first().click()
      await expect(page).toHaveURL(new RegExp('document=' + document))
      await expect(page.getByRole('img', { name: 'PDF page 1', exact: true })).toBeVisible()
      report.stages.citation_navigation = 'passed'
    } else {
      await expect(assistant.getByRole('alert')).toBeVisible()
      if (ai?.error_code === 'interaction_unavailable' && ai.retryable) {
        await expect(assistant.getByRole('alert')).toContainText('The AI provider is currently unavailable.')
        await expect(assistant.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled()
      }
      report.stages.failed_run_visible = 'passed'
    }
    expect(report.page_errors).toBe(0)
  } finally {
    if (workspace) {
      const removed = await session(() => page.request.delete('/v1/workspaces/' + workspace, { headers: { Origin: origin } }))
      report.stages.workspace_cleanup = removed.status() === 202 ? 'passed' : 'failed'
      expect.soft(removed.status()).toBe(202)
    }
    const loggedOut = await page.request.post('/v1/auth/logout', { headers: { Origin: origin } })
    report.stages.session_cleanup = loggedOut.status() === 204 ? 'passed' : 'failed'
    expect.soft(loggedOut.status()).toBe(204)
    await mkdir('/tests/test-results', { recursive: true })
    await writeFile('/tests/test-results/smoke-report.json', JSON.stringify(report, null, 2))
    console.log('SMOKE_RESULT', JSON.stringify(report))
  }
  expect(ai?.status, JSON.stringify({ error_code: report.ai_error_code })).toBe('succeeded')
})
