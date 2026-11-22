import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

type Job = { kind: string; status: string }
type Evidence = { document_id: string; page: number; text: string }
type Claim = { text: string; citations: {
  document_id: string; chunk_id: string; region?: number[] | null; citation_id?: string; segment_ids?: string[] | null; regions?: number[][]
}[] }
type Run = { run_id: string; conversation_id: string; status: string; error_code?: string; result: { tutor_question?: string | null; insufficient_evidence: boolean; claims: Claim[] } }

test('real Vietnamese PDF indexing, scoped search, grounded Ask follow-up and citation navigation', async ({ page, baseURL }) => {
  const indexTimeout = (Number(process.env.LOCAL_RAG_PARSE_SECONDS ?? 300) + 150) * 1000
  const runTimeout = (Number(process.env.LOCAL_RAG_RUN_SECONDS ?? 210) + 30) * 1000
  test.setTimeout(indexTimeout + runTimeout * 8 + 60000)
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
    let tutorConversation: string | undefined
    for (const [action, question] of [
      ['guide', 'Hãy hướng dẫn tôi tự tính hạn đăng ký mượn bộ chuyển trước buổi demo.'],
      ['hint', 'Tôi nghĩ demo lúc 14:00 thì đăng ký lúc 14:30, cho tôi một gợi ý.'],
      ['solution', 'Cho tôi xem lời giải, cần đăng ký chậm nhất mấy giờ?'],
    ] as const) {
      const submitted = await page.request.post(path + '/runs', {
        headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
        data: { mode: 'ASK', conversation_id: tutorConversation,
          objective: { query: question, capability: 'LEARN', task: 'socratic_tutor', tutor_action: action, document_ids: [document] } },
      })
      expect(submitted.status()).toBe(202)
      const id = (await submitted.json()).run_id
      let tutor: Run | undefined
      await expect.poll(async () => {
        const response = await page.request.get(path + '/runs/' + id, { timeout: 20000 })
        expect(response.status()).toBe(200)
        tutor = await response.json() as Run
        return ['succeeded', 'failed', 'cancelled'].includes(tutor.status)
      }, { timeout: runTimeout, intervals: [1000] }).toBeTruthy()
      expect(tutor?.status, JSON.stringify({ status: tutor?.status, error_code: tutor?.error_code })).toBe('succeeded')
      if (!tutor) throw new Error('Tutor returned no terminal result')
      if (tutorConversation) expect(tutor.conversation_id).toBe(tutorConversation)
      tutorConversation = tutor.conversation_id
      if (action === 'solution') {
        expect(tutor.result.tutor_question).toBeNull()
        expect(tutor.result.claims.map(claim => claim.text).join(' ')).toMatch(/13\s*(?::|h|giờ)\s*30/)
        expect(tutor.result.claims.some(claim => claim.citations.some(cite => cite.document_id === document))).toBeTruthy()
      } else {
        expect(tutor.result.tutor_question?.length).toBeGreaterThan(1)
      }
    }
    const planObjective = { query: 'Giải thích yêu cầu mượn bộ chuyển trước buổi demo.', capability: 'LEARN', task: 'explanation', document_ids: [document] }
    const steps = ['retrieve', 'compose'].map(tool => ({ step_id: randomUUID(), tool, action: tool === 'retrieve' ? 'Đọc quy định mượn thiết bị' : 'Giải thích quy định với trích dẫn',
      objective: planObjective, expected_output: 'Giải thích có căn cứ từ tài liệu' }))
    const planned = await page.request.post(path + '/plans', { headers: { Origin: origin, 'Idempotency-Key': randomUUID() }, data: { ...planObjective, steps } })
    expect(planned.status()).toBe(201)
    const plan = await planned.json()
    expect(plan.steps).toEqual(steps)
    const accepted = await page.request.post(path + '/plans/' + plan.plan_id + '/accept', {
      headers: { Origin: origin, 'Idempotency-Key': randomUUID() }, data: { plan_version: plan.plan_version },
    })
    expect(accepted.status()).toBe(200)
    const executing = await page.request.post(path + '/runs', {
      headers: { Origin: origin, 'Idempotency-Key': randomUUID() }, data: { mode: 'PLAN', plan_id: plan.plan_id, plan_version: plan.plan_version },
    })
    expect(executing.status()).toBe(202)
    const planRun = (await executing.json()).run_id
    let planResult: Run | undefined
    await expect.poll(async () => {
      const response = await page.request.get(path + '/runs/' + planRun, { timeout: 20000 })
      expect(response.status()).toBe(200)
      planResult = await response.json() as Run
      return ['succeeded', 'failed', 'cancelled'].includes(planResult.status)
    }, { timeout: runTimeout, intervals: [1000] }).toBeTruthy()
    expect(planResult?.status, JSON.stringify({ status: planResult?.status, error_code: planResult?.error_code })).toBe('succeeded')
    const progress = await page.request.get(path + '/runs/' + planRun + '/steps')
    expect(progress.status()).toBe(200)
    expect((await progress.json()).map((step: { status: string }) => step.status)).toEqual(['succeeded', 'succeeded'])
    const curriculum = await page.request.post(path + '/plans', {
      headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
      data: { query: 'Trong 3 ngày hãy học quy định tổ chức buổi demo và mượn thiết bị trong tài liệu.',
        capability: 'LEARN', task: 'study_guide', document_ids: [document], curriculum_days: 3 },
    })
    expect(curriculum.status()).toBe(201)
    const draft = await curriculum.json()
    const draftPath = path + '/plans/' + draft.plan_id
    expect(draft.state).toBe('GENERATING')
    expect((await page.request.post(draftPath + '/accept', {
      headers: { Origin: origin, 'Idempotency-Key': randomUUID() }, data: { plan_version: 1 },
    })).status()).toBe(409)
    let schedule: { state: string; generation_error?: string; steps: { day: number; citations: { document_id: string; page: number }[] }[] } | undefined
    await expect.poll(async () => {
      const response = await page.request.get(draftPath)
      expect(response.status()).toBe(200)
      schedule = await response.json()
      return schedule?.state !== 'GENERATING'
    }, { timeout: runTimeout, intervals: [1000] }).toBeTruthy()
    expect(schedule?.state, JSON.stringify({ error: schedule?.generation_error })).toBe('REVIEW')
    expect([...new Set(schedule!.steps.map(step => step.day))]).toEqual([1, 2, 3])
    expect(schedule!.steps.every(step => step.citations.length && step.citations.every(c => c.document_id === document && c.page >= 1))).toBeTruthy()
    console.log('LIVE_VERIFICATION', JSON.stringify({ workspace, document, index_status: 'succeeded',
      evidence_count: search.evidence.length, highlight_count: expectedHighlightCount, first_run: first.run_id, followup_run: followup.run_id, citation_page: number }))
  } finally {
    const cleanup = await page.request.delete(path, { headers: { Origin: origin } })
    expect(cleanup.status()).toBe(202)
  }
})
