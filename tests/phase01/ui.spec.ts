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

test('custom activities create a reviewable new plan version', async ({ page }) => {
  let version = 1
  const document = '44444444-4444-4444-8444-444444444444'
  const planId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const objective = { query: 'Learn attention in three days', document_ids: [document], capability: 'LEARN', task: 'study_guide' }
  let steps: { tool: string; action: string; objective?: typeof objective }[] = [
    { tool: 'retrieve', action: 'Find the attention section' }, { tool: 'compose', action: 'Explain attention' },
  ]
  await page.route(/\/plans(?:\/[^/?]+)?(?:\?.*)?$/, route => {
    const request = route.request()
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON()
      expect(body.expected_version).toBe(1)
      expect(body.steps).toHaveLength(3)
      expect(new Set(body.steps.map((step: { step_id: string }) => step.step_id)).size).toBe(3)
      steps = body.steps
      version = 2
    }
    return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, contentType: 'application/json', body: JSON.stringify({
      plan_id: planId, plan_version: version, objective, steps, expected_outputs: ['Cited explanation'], state: 'REVIEW', accepted_at: null,
    }) })
  })
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  await page.getByRole('checkbox', { name: 'ready.pdf', exact: true }).check()
  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await assistant.getByRole('button', { name: 'Plan', exact: true }).click()
  await assistant.getByLabel('Question or objective').fill(objective.query)
  await assistant.getByRole('button', { name: 'Create plan', exact: true }).click()
  await assistant.getByRole('button', { name: 'Customize activities', exact: true }).click()
  await assistant.getByRole('button', { name: 'Add activity', exact: true }).click()
  const source = assistant.getByRole('checkbox', { name: 'Activity source 3: ready.pdf', exact: true })
  await source.uncheck()
  await assistant.getByRole('button', { name: 'Save as new version', exact: true }).click()
  await expect(assistant.getByText('Choose at least one source for each activity.', { exact: true })).toBeVisible()
  await source.check()
  await assistant.getByRole('button', { name: 'Save as new version', exact: true }).click()
  await expect(assistant.getByRole('heading', { name: 'Plan version 2' })).toBeVisible()
  await expect(assistant.getByRole('button', { name: 'Accept plan', exact: true })).toBeVisible()
})

test('Socratic tutor keeps source scope for hints and solutions', async ({ page }) => {
  const document = '44444444-4444-4444-8444-444444444444'
  const conversation = '88888888-8888-4888-8888-888888888888'
  let current: object = {}
  let turns = 0
  await page.route(/\/runs$/, route => {
    const body = route.request().postDataJSON()
    expect(body.objective.task).toBe('socratic_tutor')
    expect(body.objective.document_ids).toEqual([document])
    if (turns > 0) expect(body.conversation_id).toBe(conversation)
    turns += 1
    current = {
      run_id: `66666666-6666-4666-8666-${String(turns).padStart(12, '0')}`, interaction: 'ASK', conversation_id: conversation,
      status: 'succeeded', step: 'compose', plan_id: null, plan_version: null, error_code: null,
      query: body.objective.query, objective: body.objective, updated_at: new Date().toISOString(),
      result: { kind: 'socratic_tutor', insufficient_evidence: false, claims: [{ text: 'The demo starts at 14:00.', citations: [] }],
        tutor_question: body.objective.tutor_action === 'solution' ? null : body.objective.tutor_action === 'hint' ? 'Em cần trừ hay cộng?' : 'Em sẽ bắt đầu từ dữ kiện nào?' },
    }
    return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(current) })
  })
  await page.route(/\/runs\/[^/]+\/events$/, route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: ' + JSON.stringify(current) + '\n\n' }))
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  await page.getByRole('checkbox', { name: 'ready.pdf', exact: true }).check()
  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await expect(assistant.getByLabel('Output').getByRole('option', { name: 'Socratic tutor' })).toHaveCount(1)
  await assistant.getByLabel('Output').selectOption('socratic_tutor')
  await assistant.getByLabel('Question or objective').fill('Hãy hướng dẫn tôi tính thời gian đăng ký.')
  await assistant.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(assistant.getByText('Em sẽ bắt đầu từ dữ kiện nào?', { exact: true })).toBeVisible()
  await assistant.getByRole('button', { name: 'More hints', exact: true }).last().click()
  await expect(assistant.getByText('Em cần trừ hay cộng?', { exact: true })).toBeVisible()
  await assistant.getByRole('button', { name: 'Show solution', exact: true }).last().click()
  await expect.poll(() => turns).toBe(3)
})

test('curriculum survives reload and only a completed cited version can be accepted', async ({ page }) => {
  const document = '44444444-4444-4444-8444-444444444444'
  const planId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const objective = { query: 'Ôn Attention trong 3 ngày', document_ids: [document], capability: 'LEARN', task: 'study_guide' }
  let ready = false
  let accepted = false
  const citation = { document_id: document, chunk_id: '77777777-7777-4777-8777-777777777777',
    name: 'ready.pdf', page: 2, text: 'Attention', section: '', region: [.1, .1, .8, .2] }
  await page.route(/\/plans(?:\/[^/?]+)?(?:\/accept)?$/, route => {
    const request = route.request()
    if (request.url().endsWith('/accept')) {
      expect(ready).toBe(true)
      expect(request.postDataJSON().plan_version).toBe(1)
      accepted = true
    } else if (request.method() === 'POST') {
      expect(request.postDataJSON().curriculum_days).toBe(3)
      expect(request.postDataJSON().task).toBe('study_guide')
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      plan_id: planId, plan_version: 1, objective, curriculum_days: 3,
      state: accepted ? 'ACCEPTED' : ready ? 'REVIEW' : 'GENERATING', generation_status: ready ? 'ready' : 'queued',
      accepted_at: accepted ? new Date().toISOString() : null, generation_error: null,
      steps: ready ? [1, 2, 3].map(day => ({ step_id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(day).padStart(12, '0')}`,
        day, tool: 'compose', action: 'Attention activity ' + day, objective,
        expected_output: day === 3 ? 'Practice quiz' : 'Q/K/V explanation', citations: [citation] })) : [],
      expected_outputs: ready ? ['Q/K/V explanation', 'Practice quiz'] : [],
    }) })
  })
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  await page.getByRole('checkbox', { name: 'ready.pdf', exact: true }).check()
  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await assistant.getByRole('button', { name: 'Plan', exact: true }).click()
  await assistant.getByLabel('Study days').selectOption('3')
  await assistant.getByLabel('Question or objective').fill(objective.query)
  await assistant.getByRole('button', { name: 'Create plan', exact: true }).click()
  await expect(assistant.getByText('Preparing schedule', { exact: true })).toBeVisible()
  await expect(assistant.getByRole('button', { name: 'Accept plan', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(assistant.getByText('Preparing schedule', { exact: true })).toBeVisible()
  ready = true
  await expect(assistant.getByText('Day 3:', { exact: true })).toBeVisible({ timeout: 10000 })
  await assistant.getByRole('button', { name: 'ready.pdf, page 2' }).first().click()
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toBeVisible()
  await expect(page.getByLabel('Citation highlight')).toBeVisible()
  await assistant.getByRole('button', { name: 'Accept plan', exact: true }).click()
  await expect(assistant.getByRole('button', { name: 'Run accepted plan', exact: true })).toBeVisible()
})

test('deep research requires multiple papers and opens matrix evidence', async ({ page }) => {
  const a = '44444444-4444-4444-8444-444444444444'
  const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  await page.request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/research', { data: { enabled: true } })
  const citation = { document_id: b, chunk_id: '77777777-7777-4777-8777-777777777777',
    name: 'Paper B.pdf', page: 2, text: 'Only B describes Dataset V2.', section: '', region: [.1,.1,.8,.2] }
  const completed = { run_id: '66666666-6666-4666-8666-666666666666', interaction: 'AGENT', status: 'succeeded',
    plan_id: null, plan_version: null, conversation_id: null, step: 'compose', error_code: null,
    query: 'Compare methods and datasets.', result: { kind: 'comparison', claims: [], insufficient_evidence: true,
      budget_exhausted: 'generation_budget', evidence_matrix: [
        { document_id: a, criterion: 'Dataset', status: 'insufficient', finding: '', citations: [] },
        { document_id: b, criterion: 'Dataset', status: 'supported', finding: 'Dataset V2', citations: [citation] },
        { document_id: a, criterion: 'Time', status: 'contradicted', finding: '99 seconds', citations: [{ ...citation, document_id: a, name: 'ready.pdf' }] },
      ] } }
  await page.route(/\/runs$/, route => route.fulfill({ status: 202, json: completed }))
  await page.route(/\/runs\/[^/]+\/events$/, route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: ' + JSON.stringify(completed) + '\n\n' }))
  await new WorkspacePage(page).open()
  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await page.getByRole('checkbox', { name: 'ready.pdf', exact: true }).check()
  await assistant.getByRole('button', { name: 'Agent', exact: true }).click()
  await assistant.getByLabel('Capability').selectOption('RESEARCH')
  await assistant.getByLabel('Output').selectOption('comparison')
  await assistant.getByLabel('Question or objective').fill(completed.query)
  await assistant.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(assistant.getByText('Choose 2–5 papers for in-depth comparison.', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Paper B.pdf', exact: true }).check()
  await assistant.getByRole('button', { name: 'Send', exact: true }).click()
  const matrix = assistant.getByRole('region', { name: 'Evidence matrix' })
  await expect(matrix.getByRole('cell', { name: 'Dataset V2', exact: true })).toBeVisible()
  await expect(matrix.getByRole('cell', { name: 'Refuted statement: 99 seconds', exact: true })).toBeVisible()
  await expect(matrix.getByRole('cell', { name: 'Not enough evidence', exact: true })).toBeVisible()
  await matrix.getByRole('button', { name: 'Paper B.pdf, page 2', exact: true }).click()
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toBeVisible({ timeout: 15000 })
})

test.afterEach(async ({ request }) => {
  await request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/research', { data: { enabled: false } })
})

test('personal flashcard review flips and records one rating on double click', async ({ page }) => {
  const artifact = '55555555-5555-4555-8555-555555555555'
  const card = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const item = { artifact_id: artifact, name: 'Private study deck', kind: 'flashcards', can_manage: false,
    spaced_repetition: true, body: { claims: [] } }
  let reviews = 0
  await page.route(/\/artifacts(?:\/[^/?]+)?$/, route => route.fulfill({ status: 200,
    json: route.request().url().endsWith('/artifacts') ? [item] : item }))
  await page.route(/\/artifacts\/[^/]+\/cards(?:\?.*)?$/, route => route.fulfill({ status: 200,
    json: { cards: reviews ? [] : [{ card_id: card, version: 0, front: 'Attention là gì?', back: 'Tổng có trọng số.', due_at: null, citations: [] }] } }))
  await page.route(/\/cards\/[^/]+\/reviews$/, async route => {
    reviews += 1
    expect(route.request().headers()['idempotency-key']).toMatch(/^[a-f0-9-]{36}$/)
    expect(route.request().postDataJSON()).toEqual({ rating: 1, expected_version: 0 })
    await route.fulfill({ status: 200, json: { card_id: card, version: 1, due_at: '2026-11-23T00:00:00Z' } })
  })
  await new WorkspacePage(page).open()
  await page.getByRole('button', { name: 'Artifacts', exact: true }).click()
  await page.getByRole('button', { name: 'Private study deck', exact: true }).click()
  const review = page.getByRole('region', { name: 'Personal review' })
  await expect(review.getByRole('heading', { name: 'Attention là gì?' })).toBeVisible()
  await expect(review.getByText('Tổng có trọng số.', { exact: true })).toHaveCount(0)
  await review.getByRole('button', { name: 'Show back', exact: true }).click()
  await expect(review.getByText('Tổng có trọng số.', { exact: true })).toBeVisible()
  await review.getByRole('button', { name: 'Again', exact: true }).evaluate(button => {
    (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click()
  })
  await expect(review.getByText('No cards are due. Come back later.', { exact: true })).toBeVisible()
  expect(reviews).toBe(1)
})

test('concept graph supports keyboard navigation, cycles and multiple PDF sources', async ({ page }) => {
  const artifact = '55555555-5555-4555-8555-555555555555'
  const document = '44444444-4444-4444-8444-444444444444'
  const label = 'Cơ chế Attention và mối quan hệ giữa truy vấn, khóa và giá trị trong mô hình ngôn ngữ'
  const citation = { document_id: document, chunk_id: '77777777-7777-4777-8777-777777777777',
    name: 'ready.pdf', page: 2, text: 'Attention', section: '', region: [.1,.1,.8,.2] }
  const item = { artifact_id: artifact, name: 'Attention concepts', kind: 'mind_map', can_manage: false,
    body: { claims: [] }, concept_map: { nodes: [
      { id: 'a', label, citations: [{ ...citation, page: 1 }, citation] },
      { id: 'b', label: 'Q / K / V', citations: [citation] },
    ], edges: [{ id: 'ab', source: 'a', target: 'b', label: 'requires' }, { id: 'ba', source: 'b', target: 'a', label: 'produces' }] } }
  await page.route(/\/artifacts(?:\/[^/?]+)?$/, route => route.fulfill({ status: 200,
    json: route.request().url().endsWith('/artifacts') ? [item] : item }))
  await new WorkspacePage(page).open()
  await page.getByRole('button', { name: 'Artifacts', exact: true }).click()
  await page.getByRole('button', { name: 'Attention concepts', exact: true }).click()
  const graph = page.getByRole('region', { name: 'Concept map' })
  await page.setViewportSize({ width: 375, height: 667 })
  await expect(graph).toBeVisible()
  await expect.poll(() => graph.locator('.table-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBeTruthy()
  const node = graph.getByRole('button', { name: label, exact: true })
  await node.focus()
  await page.keyboard.press('Enter')
  const sources = graph.getByRole('group', { name: 'Concept sources' })
  await expect(sources.getByRole('button')).toHaveCount(2)
  await sources.getByRole('button', { name: 'ready.pdf, page 2', exact: true }).click()
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByLabel('Citation highlight')).toBeVisible()
})

test('external discovery waits for query approval and handles retry before explicit save', async ({ page }) => {
  let discoveries = 0, saves = 0
  const completed = { run_id: '66666666-6666-4666-8666-666666666666', interaction: 'ASK', status: 'succeeded',
    conversation_id: '88888888-8888-4888-8888-888888888888', plan_id: null, plan_version: null, error_code: null,
    query: 'Attention datasets', result: { kind: 'answer', claims: [], insufficient_evidence: true } }
  const reference = { doi: '10.1234/demo', title: 'Synthetic attention paper', authors: ['Test'], publication_year: 2026, tags: [] }
  await page.route(/\/runs$/, route => route.fulfill({ status: 202, json: completed }))
  await page.route(/\/runs\/[^/]+\/events$/, route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: ' + JSON.stringify(completed) + '\n\n' }))
  await page.route(/\/references\/discover$/, route => {
    discoveries += 1
    expect(route.request().postDataJSON().query).toBe('Vietnamese Attention datasets')
    return route.fulfill(discoveries === 1 ? { status: 503, json: { code: 'discovery_unavailable', message: 'Crossref is temporarily unavailable.' } }
      : { status: 200, json: [reference] })
  })
  await page.route(/\/references$/, route => {
    if (route.request().method() === 'POST') { saves += 1; expect(route.request().postDataJSON().doi).toBe(reference.doi) }
    return route.fulfill({ status: 201, json: reference })
  })
  await new WorkspacePage(page).open()
  await page.getByRole('checkbox', { name: 'ready.pdf', exact: true }).check()
  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await assistant.getByLabel('Question or objective').fill(completed.query)
  await assistant.getByRole('button', { name: 'Send', exact: true }).click()
  await assistant.getByText('Find additional sources', { exact: true }).click()
  expect(discoveries).toBe(0)
  await assistant.getByLabel('Review the external search query').fill('Vietnamese Attention datasets')
  await assistant.getByRole('button', { name: 'Approve Crossref search', exact: true }).click()
  await expect(assistant.getByRole('alert')).toContainText('Crossref is temporarily unavailable.')
  await assistant.getByRole('button', { name: 'Approve Crossref search', exact: true }).click()
  await expect(assistant.getByRole('link', { name: reference.title })).toBeVisible()
  expect(saves).toBe(0)
  await assistant.getByRole('button', { name: 'Save reference', exact: true }).click()
  await expect(assistant.getByRole('button', { name: 'Reference saved', exact: true })).toBeDisabled()
  expect(saves).toBe(1)
})

test('mock defense selects the draft and keeps criticism separate from sourced claims', async ({ page }) => {
  const document = '44444444-4444-4444-8444-444444444444'
  const conversation = '88888888-8888-4888-8888-888888888888'
  let turns = 0
  let completed: object = {}
  await page.route(/\/runs$/, route => {
    const objective = route.request().postDataJSON().objective
    expect(objective.task).toBe('mock_defense')
    expect(objective.draft_document_id).toBe(document)
    if (turns) expect(route.request().postDataJSON().conversation_id).toBe(conversation)
    turns += 1
    completed = { run_id: `66666666-6666-4666-8666-${String(turns).padStart(12, '0')}`, interaction: 'ASK', status: 'succeeded',
      conversation_id: conversation, plan_id: null, plan_version: null, error_code: null, objective, query: objective.query,
      result: { kind: 'mock_defense', claims: [], insufficient_evidence: false, tutor_question: 'Bạn bảo vệ giả định này như thế nào?',
        defense_review: { assessment: 'missing_citation', assumption: 'Method generalizes.', feedback: 'Add support for the inspected claim.',
          target_citations: [{ document_id: document, chunk_id: '77777777-7777-4777-8777-777777777777', name: 'ready.pdf', page: 2,
            text: 'Draft claim', region: [.1,.1,.8,.2] }], counter_citations: [] } } }
    return route.fulfill({ status: 202, json: completed })
  })
  await page.route(/\/runs\/[^/]+\/events$/, route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: ' + JSON.stringify(completed) + '\n\n' }))
  await new WorkspacePage(page).open()
  await page.getByRole('checkbox', { name: 'ready.pdf', exact: true }).check()
  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await assistant.getByLabel('Capability').selectOption('RESEARCH')
  await assistant.getByLabel('Output').selectOption('mock_defense')
  await assistant.getByLabel('Draft to review').selectOption(document)
  await assistant.getByLabel('Question or objective').fill('Hãy phản biện giả định trong bản nháp.')
  await assistant.getByRole('button', { name: 'Send', exact: true }).click()
  const review = assistant.getByRole('region', { name: 'Mock defense review' })
  await expect(review.getByText('missing citation', { exact: true })).toBeVisible()
  await expect(assistant.getByText('Save as artifact', { exact: true })).toHaveCount(0)
  await review.getByRole('button', { name: 'ready.pdf, page 2', exact: true }).click()
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toBeVisible({ timeout: 15000 })
  await assistant.getByLabel('Question or objective').fill('Tôi chưa có trích dẫn, tôi cần bổ sung gì?')
  await assistant.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => turns).toBe(2)
})


test('provider outages show localized guidance and preserve retry', async ({ page }) => {
  const conversation = '88888888-8888-4888-8888-888888888888'
  let failed: object = {}
  await page.route(/\/runs$/, route => {
    const body = route.request().postDataJSON()
    failed = { run_id: '66666666-6666-4666-8666-666666666666', interaction: 'ASK',
      conversation_id: conversation, status: 'failed', step: 'compose', plan_id: null, plan_version: null,
      query: body.objective.query, objective: body.objective, error_code: 'interaction_unavailable', retryable: true, result: null }
    return route.fulfill({ status: 202, json: failed })
  })
  await page.route(/\/runs\/[^/]+\/events$/, route => route.fulfill({ status: 200,
    contentType: 'text/event-stream', body: 'data: ' + JSON.stringify(failed) + '\n\n' }))
  const workspace = new WorkspacePage(page)
  await workspace.open()
  await page.getByRole('checkbox', { name: 'ready.pdf', exact: true }).check()
  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await assistant.getByLabel('Question or objective').fill('Where is the demo?')
  await assistant.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(assistant.getByRole('alert')).toContainText('The AI provider is currently unavailable.')
  await expect(assistant.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Tiếng Việt', exact: true }).click()
  await expect(assistant.getByRole('alert')).toContainText('Dịch vụ AI hiện không khả dụng.')
  await expect(assistant.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled()
})
