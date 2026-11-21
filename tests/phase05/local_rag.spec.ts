import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

type Job = { kind: string; status: string }
type Evidence = { document_id: string; page: number; text: string }
type Claim = { text: string; citations: { document_id: string }[] }
type Run = { run_id: string; conversation_id: string; status: string; error_code?: string; result: { insufficient_evidence: boolean; claims: Claim[] } }

test('real Vietnamese PDF indexing, scoped search, grounded Ask follow-up and citation navigation', async ({ page, baseURL }) => {
  const indexTimeout = (Number(process.env.LOCAL_RAG_PARSE_SECONDS ?? 300) + 150) * 1000
  const runTimeout = (Number(process.env.LOCAL_RAG_RUN_SECONDS ?? 210) + 30) * 1000
  test.setTimeout(indexTimeout + runTimeout * 2 + 60000)
  const origin = baseURL!
  await page.setContent(`<!doctype html><html lang="vi"><meta charset="utf-8"><style>
    body{font-family:"DejaVu Sans",sans-serif;font-size:18px;line-height:1.6;margin:48px}
    </style><h1>Hướng dẫn buổi demo nhóm Mây Tím</h1>
    <p>Buổi demo với giảng viên diễn ra lúc 14:00 thứ Sáu tại phòng B4-201.</p>
    <p>Phòng B4-201 yêu cầu bộ chuyển HDMI sang VGA để trình chiếu.</p>
    <p>Mượn bộ chuyển tại phòng B4-105. Đăng ký ít nhất 30 phút trước buổi demo.</p></html>`)
  const pdf = await page.pdf({ format: 'A4', printBackground: true })
  const email = `live-embedding-${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('LiveTest12!')
  await page.getByLabel('Confirm password', { exact: true }).fill('LiveTest12!')
  await page.getByRole('button', { name: 'Create account', exact: true }).click({ noWaitAfter: true })
  await expect(page).toHaveURL(/\/sign-in\?registered=1$/, { timeout: 20000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('LiveTest12!')
  const loginResponse = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/v1/auth/login')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  expect((await loginResponse).status()).toBe(200)
  await expect(page).toHaveURL(/\/workspaces$/, { timeout: 20000 })
  const headers = { Origin: origin, 'Idempotency-Key': randomUUID() }
  const created = await page.request.post('/v1/workspaces', { headers, data: { name: 'Synthetic live embedding verification' } })
  expect(created.status()).toBe(201)
  const workspace = (await created.json()).workspace_id
  const path = `/v1/workspaces/${workspace}`
  try {
    const uploaded = await page.request.post(path + '/documents', {
      headers: { ...headers, 'Idempotency-Key': randomUUID(), 'X-Filename': 'local-vietnamese.pdf', 'Content-Type': 'application/octet-stream' },
      data: pdf, timeout: 135000,
    })
    expect(uploaded.status()).toBe(201)
    const document = (await uploaded.json()).document_id
    let jobs: Job[] = []
    await expect.poll(async () => {
      const response = await page.request.get(path + `/documents/${document}/jobs`, { timeout: 20000 })
      expect(response.status()).toBe(200)
      jobs = await response.json()
      return jobs.find(j => j.kind === 'index')?.status
    }, { timeout: indexTimeout, intervals: [2000], message: 'Vietnamese PDF should be indexed with the real local model' }).toBe('succeeded')
    const searched = await page.request.post(path + '/search', {
      headers: { Origin: origin }, timeout: 135000, data: { query: 'Phòng demo cần mang bộ chuyển gì?', document_ids: [document] },
    })
    expect(searched.status()).toBe(200)
    const search = await searched.json() as { indexed_documents: string[]; evidence: Evidence[] }
    expect(search.indexed_documents).toContain(document)
    expect(search.evidence.length).toBeGreaterThan(0)
    expect(search.evidence.every((e: Evidence) => e.document_id === document && e.page >= 1)).toBeTruthy()
    expect(search.evidence.map((e: Evidence) => e.text).join(' ')).toMatch(/HDMI|VGA/)
    await page.goto(`/workspaces/${workspace}`)
    const assistant = page.getByRole('region', { name: 'Workspace assistant' })
    await page.getByRole('complementary', { name: 'Workspace navigation' }).getByRole('checkbox', { name: 'local-vietnamese.pdf', exact: true }).check()
    async function ask(question: string) {
      await assistant.getByLabel('Question or objective').fill(question)
      const submitted = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(path + '/runs'))
      await assistant.getByRole('button', { name: 'Send', exact: true }).click()
      const response = await submitted
      expect(response.status()).toBe(202)
      const started = await response.json()
      let finished: Run | undefined
      await expect.poll(async () => {
        const result = await page.request.get(path + '/runs/' + started.run_id, { timeout: 20000 })
        expect(result.status()).toBe(200)
        finished = await result.json() as Run
        return !!finished && ['succeeded', 'failed', 'cancelled'].includes(finished.status)
      }, { timeout: runTimeout, intervals: [1000] }).toBeTruthy()
      expect(finished?.status, JSON.stringify({ status: finished?.status, error_code: finished?.error_code })).toBe('succeeded')
      if (!finished) throw new Error('No terminal run returned')
      expect(finished.result.insufficient_evidence).toBeFalsy()
      expect(finished.result.claims.some((c: Claim) => c.citations.some((citation: { document_id: string }) => citation.document_id === document))).toBeTruthy()
      return finished
    }
    const first = await ask('Buổi demo với giảng viên diễn ra lúc mấy giờ và ở phòng nào?')
    expect(first.result.claims.map((c: Claim) => c.text).join(' ')).toMatch(/B4\s*-\s*201/)
    const followup = await ask('Vậy phòng đó cần bộ chuyển gì để trình chiếu?')
    expect(followup.conversation_id).toBe(first.conversation_id)
    expect(followup.result.claims.map((c: Claim) => c.text).join(' ')).toMatch(/HDMI|VGA/)
    const citation = assistant.getByRole('button', { name: /local-vietnamese\.pdf, page \d+/ }).last()
    await expect(citation).toBeVisible({ timeout: 15000 })
    const number = (await citation.textContent())!.match(/page (\d+)/)![1]
    await citation.click()
    await expect(page).toHaveURL(new RegExp('[?&]document=' + document + '(&|$)'))
    await expect(page).toHaveURL(new RegExp('[?&]page=' + number + '(&|$)'))
    await expect(page.getByRole('img', { name: 'PDF page ' + number, exact: true })).toBeVisible({ timeout: 15000 })
    console.log('LIVE_VERIFICATION', JSON.stringify({ workspace, document, index_status: 'succeeded',
      evidence_count: search.evidence.length, first_run: first.run_id, followup_run: followup.run_id, citation_page: number }))
  } finally {
    const cleanup = await page.request.delete(path, { headers: { Origin: origin } })
    expect(cleanup.status()).toBe(202)
  }
})
