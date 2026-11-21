import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

type Job = { kind: string; status: string }
type Evidence = { document_id: string; page: number; text: string }
type Claim = { text: string; citations: {
  document_id: string; chunk_id: string; region?: number[] | null; citation_id?: string; segment_ids?: string[] | null; regions?: number[][]
}[] }
type Run = { run_id: string; conversation_id: string; status: string; error_code?: string; result: { insufficient_evidence: boolean; claims: Claim[] } }

test('real Vietnamese PDF indexing, scoped search, grounded Ask follow-up and citation navigation', async ({ page, baseURL }) => {
  const indexTimeout = (Number(process.env.LOCAL_RAG_PARSE_SECONDS ?? 300) + 150) * 1000
  const runTimeout = (Number(process.env.LOCAL_RAG_RUN_SECONDS ?? 210) + 30) * 1000
  test.setTimeout(indexTimeout + runTimeout * 2 + 60000)
  const origin = baseURL!
  const switchMode = process.env.EXPECT_CITATION_MODE_SWITCH === '1'
  const narrow = process.env.EXPECT_MULTILINE_CITATION === '1'
  await page.setContent(`<!doctype html><html lang="vi"><meta charset="utf-8"><style>
    body{font-family:"DejaVu Sans",sans-serif;font-size:18px;line-height:1.6;margin:48px;${narrow ? 'max-width:340px;' : ''}}
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
    const citationMode = assistant.getByRole('combobox', { name: 'Citation Mode' })
    if (switchMode) await expect(citationMode).toHaveValue('segment')
    async function ask(question: string, expectedMode?: 'segment' | 'chunk') {
      await assistant.getByLabel('Question or objective').fill(question)
      const submitted = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(path + '/runs'))
      await assistant.getByRole('button', { name: 'Send', exact: true }).click()
      const response = await submitted
      expect(response.status()).toBe(202)
      if (expectedMode) expect(response.request().postDataJSON().citation_mode).toBe(expectedMode)
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
    const firstQuery = 'Buổi demo với giảng viên diễn ra lúc mấy giờ và ở phòng nào?'
    const first = await ask(firstQuery, switchMode ? 'segment' : undefined)
    expect(first.result.claims.map((c: Claim) => c.text).join(' ')).toMatch(/B4\s*-\s*201/)
    if (switchMode) await citationMode.selectOption('chunk')
    const followup = await ask('Vậy phòng đó cần bộ chuyển gì để trình chiếu?', switchMode ? 'chunk' : undefined)
    expect(followup.conversation_id).toBe(first.conversation_id)
    expect(followup.result.claims.map((c: Claim) => c.text).join(' ')).toMatch(/HDMI|VGA/)
    let expectedHighlightCount = 0
    let preciseCitationId: string | undefined
    if (process.env.EXPECT_SENTENCE_CITATIONS === '1') {
      const anchors = followup.result.claims.flatMap(claim => claim.citations)
      const precise = anchors.find(anchor => anchor.segment_ids?.length && anchor.regions?.length)
      expect(precise?.citation_id).toBeTruthy()
      preciseCitationId = precise?.citation_id
      expectedHighlightCount = precise?.regions?.length ?? 0
      if (narrow) expect(expectedHighlightCount).toBeGreaterThan(1)
      const saved = await page.request.get(path + '/conversations/' + followup.conversation_id)
      expect(saved.status()).toBe(200)
      const history = await saved.json() as Run[]
      expect(history.find(run => run.run_id === followup.run_id)?.result).toEqual(followup.result)
      await page.reload()
      await page.getByRole('complementary', { name: 'Workspace navigation' })
        .getByRole('button', { name: 'History', exact: true }).click()
      await assistant.getByRole('button', { name: firstQuery, exact: true }).click()
    }
    if (switchMode) {
      const segmentAnchors = first.result.claims.flatMap(claim => claim.citations)
      const precise = segmentAnchors.find(anchor => anchor.segment_ids?.length && anchor.regions?.length)
      expect(precise?.citation_id).toBeTruthy()
      const chunkAnchors = followup.result.claims.flatMap(claim => claim.citations)
      expect(chunkAnchors.length).toBeGreaterThan(0)
      expect(chunkAnchors.every(anchor => anchor.segment_ids === null && !anchor.regions)).toBeTruthy()
      expect(chunkAnchors.some(anchor => anchor.region?.length === 4)).toBeTruthy()
      const currentJobs = await page.request.get(path + `/documents/${document}/jobs`)
      expect(await currentJobs.json()).toEqual(jobs)
      const saved = await page.request.get(path + '/conversations/' + first.conversation_id)
      const history = await saved.json() as Run[]
      for (const original of [first, followup]) {
        expect(history.find(item => item.run_id === original.run_id)?.result).toEqual(original.result)
      }
      await page.reload()
      await expect(citationMode).toHaveValue('chunk')
      const nav = page.getByRole('complementary', { name: 'Workspace navigation' })
      await nav.getByRole('button', { name: 'Library', exact: true }).click()
      await nav.getByRole('button', { name: 'Chats', exact: true }).click()
      await expect(citationMode).toHaveValue('chunk')
      await nav.getByRole('button', { name: 'History', exact: true }).click()
      await assistant.getByRole('button', { name: firstQuery, exact: true }).click()
      await assistant.locator(`[data-citation-id="${precise!.citation_id}"]`).first().click()
      const highlights = page.locator('.citation-highlight')
      await expect(highlights).toHaveCount(precise!.regions!.length)
      await expect(highlights.first()).toBeVisible()
    }
    const citation = preciseCitationId
      ? assistant.locator(`[data-citation-id="${preciseCitationId}"]`).last()
      : assistant.getByRole('button', { name: /local-vietnamese\.pdf, page \d+/ }).last()
    await expect(citation).toBeVisible({ timeout: 15000 })
    const number = (await citation.textContent())!.match(/page (\d+)/)![1]
    await citation.click()
    await expect(page).toHaveURL(new RegExp('[?&]document=' + document + '(&|$)'))
    await expect(page).toHaveURL(new RegExp('[?&]page=' + number + '(&|$)'))
    await expect(page.getByRole('img', { name: 'PDF page ' + number, exact: true })).toBeVisible({ timeout: 15000 })
    if (process.env.EXPECT_SENTENCE_CITATIONS === '1') {
      const highlights = page.locator('.citation-highlight')
      await expect(highlights).toHaveCount(expectedHighlightCount)
      await expect(highlights.first()).toBeVisible()
    }
    if (switchMode) {
      await expect(page.locator('.citation-highlight')).toHaveCount(1)
      await expect(page.locator('.citation-highlight')).toBeVisible()
    }
    console.log('LIVE_VERIFICATION', JSON.stringify({ workspace, document, index_status: 'succeeded',
      evidence_count: search.evidence.length, highlight_count: expectedHighlightCount, first_run: first.run_id, followup_run: followup.run_id, citation_page: number }))
  } finally {
    const cleanup = await page.request.delete(path, { headers: { Origin: origin } })
    expect(cleanup.status()).toBe(202)
  }
})
