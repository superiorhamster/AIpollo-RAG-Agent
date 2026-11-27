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

test('manual Learning Plan management works without opening a chat', async ({ page }, testInfo) => {
  let saved: { plan_id: string; state_revision: number; blueprint: object } | undefined
  const identifier = '19191919-1919-4919-8919-191919191919'
  await page.route('**/workflow-features', route => route.fulfill({ json: { learning_plans: true } }))
  await page.route('**/learning-plans**', async route => {
    const request = route.request()
    const method = request.method()
    if (method === 'GET') return route.fulfill({ json: saved ? [saved] : [] })
    if (method === 'DELETE') {
      expect(request.postDataJSON()).toEqual({ revision: saved?.state_revision })
      saved = undefined
      return route.fulfill({ status: 204 })
    }
    const data = request.postDataJSON()
    if (method === 'PUT') expect(data.revision).toBe(saved?.state_revision)
    const blueprint = method === 'POST' ? data : data.blueprint
    saved = {
      plan_id: identifier, state_revision: (saved?.state_revision ?? 0) + 1,
      blueprint: {
        ...blueprint, objectives: blueprint.objectives.map((item: object) => ({ id: identifier, ...item })),
      },
    }
    return route.fulfill({ status: method === 'POST' ? 201 : 200, json: saved })
  })
  const providerActions: string[] = []
  page.on('request', request => {
    if (request.method() === 'POST' && /\/runs$/.test(request.url())) providerActions.push(request.url())
  })
  await new WorkspacePage(page).open()
  await page.getByRole('button', { name: 'Learning Plans', exact: true }).filter({ visible: true }).first().click()
  const manager = page.getByRole('region', { name: 'Learning Plans' })
  await expect(manager.getByText('No Learning Plans yet.')).toBeVisible()
  await manager.getByRole('button', { name: 'New manual plan' }).click()
  await manager.getByLabel('Plan name').fill('Compare fractions')
  await manager.getByLabel('Learning goal').fill('Find a common denominator')
  await manager.getByRole('button', { name: 'Add activity' }).click()
  await manager.getByLabel('Activity 1').fill('Draw fraction bars')
  await manager.getByRole('button', { name: 'Save plan' }).click()
  await expect(manager.getByRole('button', { name: 'Compare fractions' })).toBeVisible()
  await manager.getByRole('button', { name: 'Edit plan' }).click()
  await manager.getByRole('checkbox', { name: 'Completed' }).check()
  await manager.getByRole('button', { name: 'Save plan' }).click()
  await expect(manager.getByText('1/1 complete')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Learning Plans', exact: true }).filter({ visible: true }).first().click()
  await manager.getByRole('button', { name: 'Compare fractions' }).click()
  await manager.getByRole('button', { name: 'Edit plan' }).click()
  await expect(manager.getByRole('checkbox', { name: 'Completed' })).toBeChecked()
  await page.screenshot({ path: testInfo.outputPath('learning-plans-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(manager.getByRole('textbox', { name: 'Plan name' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('learning-plans-mobile.png') })
  await manager.getByRole('button', { name: 'Delete plan' }).click()
  await manager.getByRole('button', { name: 'Confirm deletion' }).click()
  await expect(manager.getByText('No Learning Plans yet.')).toBeVisible()
  expect(providerActions).toEqual([])
})

test.beforeAll(async ({ browser, request }) => {
  const page = await browser.newPage()
  await page.setContent('<style>section{break-after:page;height:600px}</style><section>Page one</section><section>Page two: B4-201<br>Academic citation evidence line two<br>Nhắc lại: đọc kỹ tài liệu và trích dẫn.</section><section>Page three</section>')
  const pdf = await page.pdf({ format: 'A4' })
  await request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/pdf', { data: pdf })
  await page.close()
})

test('registration confirmation, success notice and language persist across public pages', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'AIpollo', exact: true })).toBeAttached()
  await expect(page.locator('.hero-brand-logo')).toBeVisible()
  await expect(page.locator('head link[rel="icon"]').first()).toHaveAttribute('href', /icon\.png|favicon\.ico/)
  expect((await page.request.get('/icon.png')).status()).toBe(200)
  expect((await page.request.get('/favicon.ico')).status()).toBe(200)
  await page.screenshot({ path: 'test-results/brand-home.png' })
  await page.getByRole('button', { name: 'Tiếng Việt', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Đăng nhập', exact: true })).toBeVisible()
  await page.goto('/register')
  await expect(page.getByRole('link', { name: 'AIpollo', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/brand-auth.png' })
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
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByLabel('Citation highlight')).toBeVisible()
  await page.getByRole('button', { name: 'Clear highlight', exact: true }).click()
  await expect(page.getByLabel('Citation highlight')).toHaveCount(0)
  await page.getByRole('spinbutton', { name: 'Page number' }).fill('3')
  await page.getByRole('button', { name: 'Go', exact: true }).click()
  await expect(page.getByRole('img', { name: 'PDF page 3', exact: true })).toBeVisible({ timeout: 15000 })
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
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toBeVisible({ timeout: 15000 })
  const toolbar = await page.getByRole('spinbutton', { name: 'Page number' }).boundingBox()
  expect(toolbar!.height).toBeGreaterThan(20)
  await page.screenshot({ path: 'test-results/ui-mobile-reader.png' })
})


test('preview readiness is separate from queued AI indexing', async ({ page }) => {
  await page.route('**/documents/*/jobs', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ kind: 'index', status: 'queued', attempts: 0, error_code: null }]) }))
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  await page.getByRole('button', { name: 'Documents', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: 'ready.pdf' })
  await expect(row.getByText('Ready to view', { exact: true })).toBeVisible()
  await expect(row.getByText('Queued', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'ready.pdf', exact: true })).toBeDisabled()
  await row.getByRole('button', { name: 'Open ready.pdf' }).click()
  await expect(page.getByRole('img', { name: 'PDF page 1', exact: true })).toBeVisible({ timeout: 15000 })
})

test('status polling reports transient failure and recovers with backoff', async ({ page }) => {
  let attempts = 0
  await page.route('**/documents/*/jobs', async route => {
    if (++attempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable' }) })
    return route.continue()
  })
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  await page.getByRole('button', { name: 'Documents', exact: true }).click()
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
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toBeVisible({ timeout: 15000 })
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
  await request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/research', { data: { enabled: false, clearAnnotations: true } })
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

test('library delete button removes documents without preview or polling errors and hides for viewers', async ({ page }) => {
  const brokenId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const readyId = '44444444-4444-4444-8444-444444444444'
  let brokenDeleted = false
  await page.request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/research', { data: { enabled: false, role: 'OWNER', broken: true } })
  await page.route(new RegExp(`/v1/workspaces/${workspace}/documents/${brokenId}(?:/jobs)?$`), route => {
    if (route.request().method() === 'DELETE') {
      brokenDeleted = true
      return route.fulfill({ status: 202 })
    }
    if (brokenDeleted) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'not_found', message: 'Document could not be found.' }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ kind: 'index', status: 'queued', attempts: 0, error_code: null }]) })
  })

  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  const assistant = await workspacePage.ask()
  await assistant.getByText('Save as artifact', { exact: true }).click()
  await assistant.getByRole('textbox', { name: 'Shared artifact name' }).fill('Saved fixture')
  await assistant.getByRole('button', { name: 'Save artifact', exact: true }).click()
  await expect(assistant.getByText('Artifact saved', { exact: true })).toBeVisible()

  await page.getByRole('complementary', { name: 'Workspace navigation' }).getByRole('button', { name: 'Documents', exact: true }).click()

  const brokenRow = page.getByRole('row').filter({ hasText: 'broken.docx' })
  await expect(brokenRow.getByRole('button', { name: 'Open broken.docx' })).toHaveCount(0)
  page.once('dialog', dialog => dialog.accept())
  await brokenRow.getByRole('button', { name: 'Delete broken.docx' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'broken.docx' })).toHaveCount(0)
  await expect(page.getByText('Could not update document status. Retrying with backoff.')).toHaveCount(0)

  // Deleting the ready source preserves saved artifact citation snapshots when clicked from Artifacts
  await page.route(new RegExp(`/v1/workspaces/${workspace}/documents/${readyId}$`), route => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({ status: 202 })
    }
    return route.continue()
  })
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('row').filter({ hasText: 'ready.pdf' }).getByRole('button', { name: 'Delete ready.pdf' }).click()
  await expect(page.getByText('There are no documents in this workspace.')).toBeVisible()

  await page.getByRole('complementary', { name: 'Workspace navigation' }).getByRole('button', { name: 'Artifacts', exact: true }).click()
  await page.getByRole('button', { name: 'Saved fixture', exact: true }).click()
  await page.locator('.artifact-library').getByRole('button', { name: 'ready.pdf, page 2' }).click()
  const unavailableRegion = page.getByRole('region', { name: 'Document preview' })
  await expect(unavailableRegion.getByText('This source document has been deleted from the workspace. The saved citation snapshot is preserved below.')).toBeVisible()
  await expect(unavailableRegion.getByText('The demo is in B4-201.')).toBeVisible()
})

test('viewer role cannot see delete button in workspace library', async ({ page }) => {
  await page.request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/research', { data: { enabled: false, role: 'VIEWER', broken: false } })
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  await page.getByRole('complementary', { name: 'Workspace navigation' }).getByRole('button', { name: 'Documents', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: 'ready.pdf' })
  await expect(row.getByRole('button', { name: 'Open ready.pdf' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Delete ready.pdf' })).toHaveCount(0)
})

test('workspace sidebar and reader panels can be dragged to resize, persist, and reset on double click', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()

  const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' })
  const reader = page.getByRole('region', { name: 'Document preview' })
  const sidebarResizer = page.getByRole('separator', { name: 'Resize navigation sidebar' })
  const readerResizer = page.getByRole('separator', { name: 'Resize document reader' })

  const initialSidebar = (await sidebar.boundingBox())!.width
  const initialReader = (await reader.boundingBox())!.width
  expect(Math.round(initialSidebar)).toBe(264)

  const sbHandle = (await sidebarResizer.boundingBox())!
  await page.mouse.move(sbHandle.x + sbHandle.width / 2, sbHandle.y + 100)
  await page.mouse.down()
  await page.mouse.move(sbHandle.x + sbHandle.width / 2 + 80, sbHandle.y + 100, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(Math.round(initialSidebar + 80))

  const rdHandle = (await readerResizer.boundingBox())!
  await page.mouse.move(rdHandle.x + rdHandle.width / 2, rdHandle.y + 100)
  await page.mouse.down()
  await page.mouse.move(rdHandle.x + rdHandle.width / 2 - 100, rdHandle.y + 100, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await reader.boundingBox())!.width)).toBe(Math.round(initialReader + 100))

  // Widths persist across reload via localStorage
  await page.reload()
  await expect(sidebar).toBeVisible()
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(Math.round(initialSidebar + 80))
  await expect.poll(async () => Math.round((await reader.boundingBox())!.width)).toBe(Math.round(initialReader + 100))

  // Double-click resets sidebar width to default
  await sidebarResizer.dblclick()
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(264)

  // Hiding reader also hides its resizer
  await page.getByRole('button', { name: 'Hide reader' }).click()
  await expect(readerResizer).toBeHidden()
})

// Exercise the web relay deadline independently of Gateway's delayed HTTP test.
test('web relay allows slow registration and login responses', async ({ request, baseURL }) => {
  const options = { headers: { Origin: baseURL! }, timeout: 20000,
    data: { email: 'slow-auth@example.com', password: 'Fixture12!' } }
  const [registered, signedIn] = await Promise.all([
    request.post('/v1/auth/register', options), request.post('/v1/auth/login', options),
  ])
  expect(registered.status()).toBe(201)
  expect(signedIn.status()).toBe(200)
})


test('EmbedPDF selects text, retries one highlight, and persists note edits without duplication', async ({ page }) => {
  test.slow()
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  const assistant = await workspacePage.ask()
  await assistant.getByRole('button', { name: 'ready.pdf, page 2' }).click()
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toHaveAttribute('data-rendered', 'true', { timeout: 15000 })
  const notes = page.getByRole('region', { name: 'Personal annotations' })
  await notes.getByRole('button', { name: 'Select page text' }).click()
  await expect(notes.getByRole('button', { name: 'Highlight text', exact: true })).toBeEnabled()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await notes.getByRole('button', {name:'Copy text',exact:true}).click()
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).normalize('NFC'))).toContain('Nhắc lại: đọc kỹ tài liệu và trích dẫn.')
  const posted: { key: string; body: { embedpdf: { quadPoints: unknown[] } } }[] = []
  await page.route('**/documents/*/annotations', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    posted.push({key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON()})
    if (posted.length === 1) return route.fulfill({status: 503, json: { message: 'Synthetic annotation outage.' }})
    return route.continue()
  })
  await notes.getByRole('button', { name: 'Highlight text', exact: true }).click()
  await expect(notes.getByRole('alert')).toHaveText('Synthetic annotation outage.')
  await notes.getByRole('button', { name: 'Retry saving annotation' }).click()
  await expect(notes.getByRole('status')).toHaveText('Annotation saved.')
  expect(posted).toHaveLength(2)
  expect(posted[1]).toEqual(posted[0])
  expect(posted[0].body.embedpdf.quadPoints.length).toBeGreaterThan(1)
  await notes.getByRole('button', { name: 'Expand notes', exact: true }).click()
  await expect(notes.getByRole('listitem')).toHaveCount(1)
  await notes.getByRole('button', { name: 'Annotation actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit annotation', exact: true }).click()
  await notes.getByLabel('Personal note').fill('Vietnamese reading note: chú ý bằng chứng.')
  await notes.getByRole('button', { name: 'Save changes' }).click()
  await expect(notes.getByRole('listitem').getByText('Vietnamese reading note: chú ý bằng chứng.', { exact: true })).toBeVisible()
  await expect(notes.getByRole('button', {name:'Save changes',exact:true})).toHaveCount(0)
  await page.screenshot({path:'test-results/embedpdf-highlight-note.png'})
  await page.reload()
  await expect(page.getByRole('img', {name:'PDF page 2',exact:true})).toHaveAttribute('data-rendered','true',{timeout:15000})
  await notes.getByRole('button', { name: 'Expand notes', exact: true }).click()
  await expect(notes.getByRole('listitem').getByText('Vietnamese reading note: chú ý bằng chứng.', { exact: true })).toBeVisible()
  await expect(notes.getByRole('listitem')).toHaveCount(1)
  expect(posted).toHaveLength(2) // Hydration never echoes a POST.
  await notes.getByRole('button', { name: 'Annotation actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Remove annotation', exact: true }).click()
  await notes.getByRole('button', { name: 'Confirm delete', exact: true }).click()
  await expect(notes.getByRole('listitem')).toHaveCount(0)
  expect(requests.filter(url => /^https?:/.test(url) && !url.startsWith(new URL(page.url()).origin))).toEqual([])
})

test('EmbedPDF fits mixed page shapes and transforms citations on rotation', async ({ page }) => {
  test.slow()
  const objects: string[] = [ '', '' ]
  const shapes = [[300,600,0],[600,300,0],[500,500,90],[400,1600,0],[500,700,270],[300,400,0]]
  const fontId = shapes.length*2+3
  for (const [w,h,rotation] of shapes) {
    const id = objects.length + 1
    const stream = objects.length === 12 ? '0.8 0.9 0.95 rg 0 0 300 400 re f' : 'BT /F1 16 Tf 40 150 Td (Selectable shape fixture) Tj ET'
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Rotate ${rotation} ${objects.length===10?'/CropBox [50 100 450 600]':''} /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${id+1} 0 R >>`)
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] = `<< /Type /Pages /Count ${shapes.length} /Kids [${shapes.map((_,i)=>`${i*2+3} 0 R`).join(' ')}] >>`
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((obj,i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${obj}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10,'0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  await page.route('**/documents/*/preview', route => route.fulfill({contentType:'application/pdf',body:Buffer.from(pdf)}))
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  const assistant = await workspacePage.ask()
  await assistant.getByRole('button', { name: 'ready.pdf, page 2' }).click()
  const paper = page.getByRole('region', { name: 'Scrollable PDF page' })
  const ratio = async () => {
    const box = await page.locator('.embed-page').boundingBox()
    return box!.width/box!.height
  }
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toHaveAttribute('data-rendered','true', { timeout: 15000 })
  expect(await ratio()).toBeCloseTo(2,1)
  const bounds = async () => {
    const sheet = (await page.locator('.embed-page').boundingBox())!
    const mark = (await page.getByLabel('Citation highlight').boundingBox())!
    return [(mark.x-sheet.x)/sheet.width,(mark.y-sheet.y)/sheet.height,mark.width/sheet.width,mark.height/sheet.height]
  }
  const before = await bounds()
  before.forEach((v,i)=>expect(v).toBeCloseTo([.1,.1,.7,.1][i],1))
  await page.getByRole('button',{name:'Rotate clockwise'}).click()
  await expect.poll(ratio).toBeCloseTo(.5,1)
  const after = await bounds()
  after.forEach((v,i)=>expect(v).toBeCloseTo([.8,.1,.1,.7][i],1))
  for (const n of [1,3,4,5,6]) {
    await page.getByRole('spinbutton',{name:'Page number'}).fill(String(n))
    await page.getByRole('button',{name:'Go',exact:true}).click()
    await expect(page.getByRole('img',{name:'PDF page '+n,exact:true})).toHaveAttribute('data-rendered','true', { timeout: 15000 })
    expect(await ratio()).toBeCloseTo(n===6?.75:n===5?1.25:n===4?.25:n===3?1:.5,1)
    await page.getByRole('button',{name:'Fit page',exact:true}).click()
    const sheet = (await page.locator('.embed-page').boundingBox())!
    const viewport = (await paper.boundingBox())!
    expect(sheet.height).toBeLessThanOrEqual(viewport.height)
    await page.getByRole('button',{name:'Fit width',exact:true}).click()
  }
  const notes = page.getByRole('region', {name:'Personal annotations'})
  await notes.getByRole('button',{name:'Select page text'}).click()
  await expect(notes.getByRole('button',{name:'Highlight text',exact:true})).toBeDisabled()
  await notes.getByRole('button',{name:'Select highlight',exact:true}).click()
  const box=(await page.locator('.embed-page').boundingBox())!
  await page.mouse.move(box.x+box.width*.1,box.y+box.height*.1)
  await page.mouse.down()
  await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3)
  await page.mouse.up()
  await notes.getByRole('button',{name:'Expand notes',exact:true}).click()
  await expect(notes.getByRole('listitem')).toHaveCount(1)
  await notes.getByRole('button',{name:'Annotation actions',exact:true}).click()
  await page.getByRole('menuitem',{name:'Remove annotation',exact:true}).click()
  await notes.getByRole('button',{name:'Confirm delete',exact:true}).click()
  await expect(notes.getByRole('listitem')).toHaveCount(0)
  for(let i=0;i<20;i++) {
    await page.getByRole('button',{name:i%2===0?'Previous page':'Next page',exact:true}).click()
  }
  await expect(page.locator('.embed-page')).toHaveCount(1)
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'Fit width',exact:true}).click()
  await expect.poll(async()=>{const p=(await paper.boundingBox())!;const s=(await page.locator('.embed-page').boundingBox())!;return s.width<=p.width}).toBeTruthy()
})


test('EmbedPDF renews an expired session and replays the protected PDF download', async ({ page }) => {
  test.slow()
  let downloads = 0
  let refreshes = 0
  let renewed = false
  await page.route('**/v1/auth/me', route => route.fulfill(renewed ? {status:200,json:{
    user_id:'11111111-1111-4111-8111-111111111111',email:'ui-fixture@example.com',role:'USER'
  }} : {status:401,json:{code:'unauthorized',message:'Synthetic expired access token.'}}))
  await page.route('**/v1/auth/refresh', route => {
    refreshes++; renewed = true
    return route.fulfill({status:204})
  })
  await page.route('**/documents/*/preview', route => {
    downloads++
    if (downloads === 1) return route.fulfill({status:401,json:{code:'unauthorized',message:'Synthetic expired access token.'}})
    return route.continue()
  })
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  const assistant = await workspacePage.ask()
  await assistant.getByRole('button', {name:'ready.pdf, page 2'}).click()
  await expect(page.getByRole('img',{name:'PDF page 2',exact:true})).toHaveAttribute('data-rendered','true',{timeout:20000})
  expect(downloads).toBe(2)
  expect(refreshes).toBe(1)
})

test('compact reader toolbar supports Vietnamese search, portal dropdown, inline rename, download, delete, and desktop/mobile layout', async ({ page }) => {
  test.slow()
  const docA = '44444444-4444-4444-8444-444444444444'
  const docB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const docC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const longName = 'Tài liệu nghiên cứu chuyên sâu về mô hình Retrieval-Augmented Generation và đơn giá phân tích dữ liệu năm 2026.pdf'
  await page.request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/research', {
    data: {
      enabled: false,
      role: 'OWNER',
      documents: [
        { document_id: docA, workspace_id: workspace, name: 'ready.pdf', filename: 'ready.pdf', media_type: 'application/pdf', size_bytes: 1200, preview_ready: true, created_at: '2026-11-21T00:00:00Z' },
        { document_id: docB, workspace_id: workspace, name: longName, filename: 'bao-cao-goc-2026.pdf', media_type: 'application/pdf', size_bytes: 2400, preview_ready: true, created_at: '2026-11-21T00:00:00Z' },
        { document_id: docC, workspace_id: workspace, name: 'Bản thảo chưa xem trước.docx', filename: 'ban-thao.docx', media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: 500, preview_ready: false, created_at: '2026-11-21T00:00:00Z' },
      ],
    },
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()

  const reader = page.getByRole('region', { name: 'Document preview' })
  // Check RAG source checkbox stays preserved when switching preview doc
  const ragCheckbox = page.getByRole('checkbox', { name: 'ready.pdf', exact: true })
  await ragCheckbox.check()

  await expect(page.getByRole('img', { name: 'PDF page 1', exact: true })).toHaveAttribute('data-rendered', 'true', { timeout: 15000 })
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByText('Page 2 of 3')).toBeVisible()

  // Switch to long document and inspect ellipsis + desktop screenshot
  const trigger = reader.getByRole('button', { name: 'ready.pdf', exact: true })
  await trigger.click()
  const searchInput = page.getByRole('searchbox', { name: 'Search documents' })
  await expect(searchInput).toBeFocused()
  // Test Vietnamese diacritic-insensitive search + original filename search
  await searchInput.fill('don gia')
  await expect(page.getByRole('option', { name: new RegExp(longName.slice(0, 25)) })).toBeVisible()
  await searchInput.fill('bao-cao-goc')
  const longOption = page.getByRole('option', { name: new RegExp(longName.slice(0, 25)) })
  await expect(longOption).toBeVisible()
  await searchInput.fill('khong co ket qua nao')
  await expect(page.getByText('No matching documents.')).toBeVisible()
  await searchInput.fill('')

  // Verify listbox is inside viewport and not clipped by reader scroll
  await reader.evaluate(el => { el.scrollTop = 40 })
  const listboxBox = await page.getByRole('listbox', { name: 'Workspace documents' }).boundingBox()
  expect(listboxBox!.y).toBeGreaterThanOrEqual(0)
  expect(listboxBox!.y + listboxBox!.height).toBeLessThanOrEqual(900)
  await page.screenshot({ path: 'test-results/reader-bar-dropdown.png' })

  // Select unpreviewed doc via keyboard ArrowDown/Enter or click and switch back
  await page.getByRole('option', { name: /Bản thảo chưa xem trước\.docx/ }).click()
  await expect(reader.getByText('PDF preview is queued.')).toBeVisible()
  await expect(ragCheckbox).toBeChecked()

  // Select long doc and verify truncation & tooltip
  await reader.getByRole('button', { name: 'Bản thảo chưa xem trước.docx' }).click()
  await page.getByRole('option', { name: new RegExp(longName.slice(0, 25)) }).click()
  const longTrigger = reader.getByRole('button', { name: longName, exact: true })
  await expect(longTrigger).toHaveAttribute('title', longName)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'test-results/reader-bar-desktop.png' })

  // Switch back to ready.pdf (keeps page 1 after doc switch) and test Escape on picker
  await longTrigger.click()
  await page.keyboard.press('Escape')
  await expect(longTrigger).toBeFocused()
  await longTrigger.click()
  await page.getByRole('option', { name: 'ready.pdf', exact: true }).click()

  // Test actions menu + inline rename validation, error retention, cancel, and success
  const actionsBtn = reader.getByRole('button', { name: 'Document actions', exact: true })
  await actionsBtn.click()
  await page.screenshot({ path: 'test-results/reader-bar-menu.png' })
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()

  const renameInput = reader.getByRole('textbox', { name: 'Document name', exact: true })
  await expect(renameInput).toBeFocused()
  await page.screenshot({ path: 'test-results/reader-bar-rename.png' })

  // Escape cancels rename cleanly
  await page.keyboard.press('Escape')
  await expect(renameInput).toHaveCount(0)

  // Validation error preserves input
  await actionsBtn.click()
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  await renameInput.fill('   ')
  await reader.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(reader.getByRole('alert')).toContainText('1 and 200 characters')

  // Server failure preserves input and keeps form open
  let failOnce = true
  await page.route(`**/documents/${docA}`, route => {
    if (route.request().method() === 'PATCH' && failOnce) {
      failOnce = false
      return route.fulfill({ status: 500, json: { message: 'Rename service failure.' } })
    }
    return route.continue()
  })
  await renameInput.fill('Báo cáo đã đổi tên')
  await renameInput.press('Enter')
  await expect(reader.getByRole('alert')).toHaveText('Rename service failure.')
  await expect(renameInput).toHaveValue('Báo cáo đã đổi tên')

  // Retry rename succeeds, closes form, updates dropdown & Library
  await reader.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(renameInput).toHaveCount(0)
  await expect(reader.getByRole('button', { name: 'Báo cáo đã đổi tên', exact: true })).toBeVisible()
  await page.getByRole('complementary', { name: 'Workspace navigation' }).getByRole('button', { name: 'Documents', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Báo cáo đã đổi tên' })).toBeVisible()

  // Download icon button triggers download with original filename
  const downloadPromise = page.waitForEvent('download')
  await reader.getByRole('button', { name: 'Download original', exact: true }).click()
  expect((await downloadPromise).suggestedFilename()).toBe('ready.pdf')

  // Mobile layout screenshot & zero horizontal overflow
  await page.setViewportSize({ width: 375, height: 667 })
  await page.getByRole('tab', { name: 'Reader' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'test-results/reader-bar-mobile.png' })
  await reader.getByRole('button', { name: 'Báo cáo đã đổi tên', exact: true }).click()
  await expect(page.getByRole('listbox', { name: 'Workspace documents' })).toBeVisible()
  await page.screenshot({ path: 'test-results/reader-bar-mobile-dropdown.png' })
  await page.keyboard.press('Escape')

  // Cancel delete keeps document; confirm deletes through to empty state
  await page.setViewportSize({ width: 1440, height: 900 })
  await actionsBtn.click()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('menuitem', { name: 'Delete document', exact: true }).click()
  await expect(reader.getByRole('button', { name: 'Báo cáo đã đổi tên', exact: true })).toBeVisible()

  for (const name of ['Báo cáo đã đổi tên', longName, 'Bản thảo chưa xem trước.docx']) {
    await reader.getByRole('button', { name: 'Document actions', exact: true }).click()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('menuitem', { name: 'Delete document', exact: true }).click()
    await expect(reader.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await expect(reader.getByText('Select a document to preview it.')).toBeVisible()
})

test('reader toolbar enforces VIEWER permissions and locks controls while annotation retry is pending', async ({ page }) => {
  test.slow()
  // VIEWER role: can select and download, cannot open Rename/Delete menu
  await page.request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/research', {
    data: { enabled: false, role: 'VIEWER', broken: false },
  })
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  const reader = page.getByRole('region', { name: 'Document preview' })
  await expect(reader.getByRole('button', { name: 'ready.pdf', exact: true })).toBeEnabled()
  await expect(reader.getByRole('button', { name: 'Download original', exact: true })).toBeEnabled()
  await expect(reader.getByRole('button', { name: 'Document actions', exact: true })).toHaveCount(0)

  // OWNER with pending annotation outage locks doc switching, rename/delete menu, and hide reader
  await page.request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/research', {
    data: { enabled: true, role: 'OWNER', broken: false },
  })
  await workspacePage.open()
  const assistant = await workspacePage.ask()
  await assistant.getByRole('button', { name: 'ready.pdf, page 2' }).click()
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toHaveAttribute('data-rendered', 'true', { timeout: 15000 })

  await page.route('**/documents/*/annotations', route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 503, json: { message: 'Temporary annotation error.' } })
    }
    return route.continue()
  })
  const notes = page.getByRole('region', { name: 'Personal annotations' })
  await notes.getByRole('button', { name: 'Add note', exact: true }).click()
  await notes.getByLabel('Personal note').fill('Pending note lock check')
  await notes.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(notes.getByRole('button', { name: 'Retry saving annotation' })).toBeVisible()

  await expect(reader.getByText('Save or discard the pending annotation before switching, renaming, or deleting.')).toBeVisible()
  await expect(reader.getByRole('button', { name: 'ready.pdf', exact: true })).toBeDisabled()
  await expect(reader.getByRole('button', { name: 'Document actions', exact: true })).toBeDisabled()
  await expect(reader.getByRole('button', { name: 'Hide reader', exact: true })).toBeDisabled()
  await expect(reader.getByRole('button', { name: 'Download original', exact: true })).toBeEnabled()
})

test('failed indexing shows localized Retry button that re-queues and resumes polling', async ({ page }) => {
  const readyId = '44444444-4444-4444-8444-444444444444'
  let jobState: { status: string; error_code: string | null } = { status: 'failed', error_code: 'parse_timeout' }
  let pollsAfterRetry = 0

  await page.route(`**/documents/${readyId}/jobs`, route => {
    if (jobState.status === 'queued') {
      pollsAfterRetry += 1
      if (pollsAfterRetry >= 2) jobState = { status: 'succeeded', error_code: null }
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ job_id: '99999999-9999-4999-8999-999999999999', kind: 'index', attempts: 1, ...jobState }]),
    })
  })
  await page.route(`**/documents/${readyId}/retry`, route => {
    expect(route.request().method()).toBe('POST')
    jobState = { status: 'queued', error_code: null }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ job_id: '99999999-9999-4999-8999-999999999999', kind: 'index', attempts: 0, ...jobState }]),
    })
  })

  // VIEWER role cannot see Retry button on failed indexing
  await page.request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/research', {
    data: { enabled: false, role: 'VIEWER', broken: false },
  })
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()
  await page.getByRole('complementary', { name: 'Workspace navigation' }).getByRole('button', { name: 'Documents', exact: true }).click()
  const viewerRow = page.getByRole('row').filter({ hasText: 'ready.pdf' })
  await expect(viewerRow.getByText('Failed', { exact: true })).toBeVisible()
  await expect(viewerRow.getByRole('button', { name: 'Retry ready.pdf' })).toHaveCount(0)

  // OWNER sees localized Retry / Thử lại button and recovers back to Ready
  await page.request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/research', {
    data: { enabled: false, role: 'OWNER', broken: false },
  })
  await workspacePage.open()
  await page.getByRole('complementary', { name: 'Workspace navigation' }).getByRole('button', { name: 'Documents', exact: true }).click()
  const ownerRow = page.getByRole('row').filter({ hasText: 'ready.pdf' })
  await expect(ownerRow.getByText('Processing time limit exceeded. Preview remains available.')).toBeVisible()

  await page.getByRole('button', { name: 'Tiếng Việt', exact: true }).click()
  const retryVi = ownerRow.getByRole('button', { name: 'Thử lại ready.pdf' })
  await expect(retryVi).toBeVisible()
  await retryVi.click()

  await expect(ownerRow.getByText('Sẵn sàng', { exact: true })).toBeVisible({ timeout: 10000 })
  await expect(ownerRow.getByRole('button', { name: 'Thử lại ready.pdf' })).toHaveCount(0)
})

test('compact annotations panel collapses by default, preserves drafts and order, and adapts to narrow/wide/mobile layouts', async ({ page }) => {
  test.slow()
  await page.request.post((process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001') + '/__fixture/research', {
    data: { enabled: true, role: 'OWNER', broken: false },
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  const workspacePage = new WorkspacePage(page)
  await workspacePage.open()

  const assistant = await workspacePage.ask()
  await assistant.getByRole('button', { name: 'ready.pdf, page 2' }).click()
  await expect(page.getByRole('img', { name: 'PDF page 2', exact: true })).toHaveAttribute('data-rendered', 'true', { timeout: 15000 })

  const notes = page.getByRole('region', { name: 'Personal annotations' })
  const expandBtn = notes.getByRole('button', { name: 'Expand notes', exact: true })
  await expect(expandBtn).toHaveAttribute('aria-expanded', 'false')
  await expect(notes.getByLabel('Personal note')).toHaveCount(0)
  await expect(notes.getByRole('button', { name: 'Copy text', exact: true })).toBeDisabled()
  await expect(notes.getByRole('button', { name: 'Highlight text', exact: true })).toBeDisabled()
  await expect(notes.getByRole('button', { name: 'Select highlight', exact: true })).toBeEnabled()

  // Expanding empty panel shows helpful guidance; wide panel (>420px) shows tool labels
  await expandBtn.click()
  await expect(notes.getByRole('button', { name: 'Collapse notes', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(notes.getByText('No notes or highlights on this page yet. Select text, mark a region, or click Add note.')).toBeVisible()

  // Scan-style area prompt shows instruction and Cancel
  await notes.getByRole('button', { name: 'Select highlight', exact: true }).click()
  await expect(notes.getByText('Drag across a region on the PDF page.')).toBeVisible()
  await notes.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(notes.getByText('Drag across a region on the PDF page.')).toHaveCount(0)

  // Add first and second notes on page 2, verify counter and 3s saved pill auto-hide
  await notes.getByRole('button', { name: 'Add note', exact: true }).click()
  await expect(notes.getByRole('heading', { name: 'New note · p. 2' })).toBeVisible()
  await expect(notes.getByText('0/3000')).toBeVisible()
  await notes.getByLabel('Personal note').fill('First page 2 note')
  await expect(notes.getByText('17/3000')).toBeVisible()
  await notes.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(notes.getByRole('status')).toHaveText('Annotation saved.')
  await expect(notes.getByRole('status').filter({ hasText: 'Annotation saved.' })).toHaveCount(0, { timeout: 5000 })

  await notes.getByRole('button', { name: 'Add note', exact: true }).click()
  await notes.getByLabel('Personal note').fill('Second page 2 note')
  await notes.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(notes.getByText('p. 2 · 2 items')).toBeVisible()

  // Editing first item preserves order
  const firstMenuBtn = notes.getByRole('listitem').first().getByRole('button', { name: 'Annotation actions', exact: true })
  await firstMenuBtn.click()
  await page.keyboard.press('Escape')
  await expect(firstMenuBtn).toBeFocused()
  await firstMenuBtn.click()
  await page.getByRole('menuitem', { name: 'Edit annotation', exact: true }).click()
  await notes.getByLabel('Personal note').fill('First page 2 note (edited)')
  await notes.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(notes.getByRole('listitem').nth(0)).toContainText('First page 2 note (edited)')
  await expect(notes.getByRole('listitem').nth(1)).toContainText('Second page 2 note')

  // Capture wide panel screenshot (expand reader width first via resizer)
  const readerResizer = page.getByRole('separator', { name: 'Resize document reader' })
  const rdHandle = (await readerResizer.boundingBox())!
  await page.mouse.move(rdHandle.x + rdHandle.width / 2, rdHandle.y + 120)
  await page.mouse.down()
  await page.mouse.move(rdHandle.x + rdHandle.width / 2 - 140, rdHandle.y + 120, { steps: 4 })
  await page.mouse.up()
  await page.screenshot({ path: 'test-results/annotations-wide-panel.png' })

  // Capture narrow panel screenshot (~310px)
  const rdHandle2 = (await readerResizer.boundingBox())!
  await page.mouse.move(rdHandle2.x + rdHandle2.width / 2, rdHandle2.y + 120)
  await page.mouse.down()
  await page.mouse.move(rdHandle2.x + rdHandle2.width / 2 + 250, rdHandle2.y + 120, { steps: 4 })
  await page.mouse.up()
  await page.screenshot({ path: 'test-results/annotations-narrow-panel.png' })

  // Draft bound to page 2 persists when collapsing and navigating to page 1, and prompts confirm on discard
  await notes.getByRole('button', { name: 'Add note', exact: true }).click()
  await notes.getByLabel('Personal note').fill('Draft bound to page 2')
  await notes.getByRole('button', { name: 'Collapse notes', exact: true }).click()
  await page.getByRole('button', { name: 'Previous page', exact: true }).click()
  await expect(notes.getByText('p. 1 · 0 items')).toBeVisible()
  await notes.getByRole('button', { name: 'Expand notes', exact: true }).click()
  await expect(notes.getByRole('heading', { name: 'New note · p. 2' })).toBeVisible()
  await expect(notes.getByLabel('Personal note')).toHaveValue('Draft bound to page 2')

  // Cancel switching doc when dirty keeps current doc and draft
  const reader = page.getByRole('region', { name: 'Document preview' })
  await reader.getByRole('button', { name: 'ready.pdf', exact: true }).click()
  page.once('dialog', d => d.dismiss())
  await page.getByRole('option', { name: 'Paper B.pdf', exact: true }).click()
  await expect(reader.getByRole('button', { name: 'ready.pdf', exact: true })).toBeVisible()
  await expect(notes.getByLabel('Personal note')).toHaveValue('Draft bound to page 2')

  // Cancel hiding reader when dirty keeps reader open
  page.once('dialog', d => d.dismiss())
  await reader.getByRole('button', { name: 'Hide reader', exact: true }).click()
  await expect(reader).toBeVisible()

  // Cancel editing another item when dirty keeps draft; saving binds to page 2
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(notes.getByText('p. 2 · 2 items')).toBeVisible()
  await notes.getByRole('listitem').first().getByRole('button', { name: 'Annotation actions', exact: true }).click()
  page.once('dialog', d => d.dismiss())
  await page.getByRole('menuitem', { name: 'Edit annotation', exact: true }).click()
  await expect(notes.getByLabel('Personal note')).toHaveValue('Draft bound to page 2')
  await notes.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(notes.getByText('p. 2 · 3 items')).toBeVisible()

  // Vietnamese localization & mobile screenshot (collapsed by default)
  await readerResizer.dblclick()
  await page.getByRole('button', { name: 'Tiếng Việt', exact: true }).click()
  const notesVi = page.getByRole('region', { name: 'Ghi chú cá nhân' })
  await expect(notesVi.getByRole('heading', { name: 'Ghi chú & đánh dấu' })).toBeVisible()
  await notesVi.getByRole('button', { name: 'Thu gọn ghi chú', exact: true }).click()
  await page.setViewportSize({ width: 375, height: 667 })
  await page.getByRole('tab', { name: 'Trình đọc' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'test-results/annotations-mobile-panel.png' })
})

test('workspace sidebar tree prevents overflow at 180px, separates open vs source selection, and isolates workspaces', async ({ page }) => {
  const readyId = '44444444-4444-4444-8444-444444444444'
  const longNoSpace = 'TàiLiệuNghiênCứuTiếngViệtRấtDàiKhôngCóKhoảngTrắngĐểKiểmTraCắtChữVàChốngTrànSidebar.pdf'
  const longDocId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const processingDocId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  const processingName = 'TàiLiệuĐangXửLýRấtDàiKhôngKhoảngTrắngChoBadge.pdf'
  const gw = process.env.UI_TEST_GATEWAY_URL ?? 'http://127.0.0.1:24001'

  try {
    await page.request.post(gw + '/__fixture/research', {
      data: {
        enabled: false,
        role: 'OWNER',
        broken: false,
        secondaryWorkspace: true,
        documents: [
          { document_id: readyId, workspace_id: workspace, name: 'ready.pdf', filename: 'ready.pdf', media_type: 'application/pdf', size_bytes: 100, preview_ready: true, created_at: '2026-11-21T00:00:00Z' },
          { document_id: longDocId, workspace_id: workspace, name: longNoSpace, filename: longNoSpace, media_type: 'application/pdf', size_bytes: 100, preview_ready: true, created_at: '2026-11-22T00:00:00Z' },
          { document_id: processingDocId, workspace_id: workspace, name: processingName, filename: processingName, media_type: 'application/pdf', size_bytes: 100, preview_ready: true, created_at: '2026-11-23T00:00:00Z' },
        ],
      },
    })
    await page.route(`**/documents/${processingDocId}/jobs`, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ job_id: '99999999-9999-4999-8999-999999999998', kind: 'index', status: 'running', attempts: 0, error_code: null }]),
    }))

    await page.setViewportSize({ width: 1440, height: 900 })
    const workspacePage = new WorkspacePage(page)
    await workspacePage.open()

    const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' })
    const toggleA = sidebar.getByRole('button', { name: 'Collapse UI fixture workspace', exact: true })
    const toggleB = sidebar.getByRole('button', { name: 'Expand Workspace Nghiên Cứu Hai Không Có Khoảng TrắngDài', exact: true })
    await expect(toggleA).toHaveAttribute('aria-expanded', 'true')
    await expect(toggleB).toHaveAttribute('aria-expanded', 'false')

    // All 7 ordered sections render inside current workspace tree
    const sectionLabels = await sidebar.getByRole('navigation', { name: 'Workspace sections' }).getByRole('button').allTextContents()
    expect(sectionLabels.map(s => s.trim())).toEqual(['Chats', 'Documents', 'Notes', 'Plans', 'Artifacts', 'References', 'History'])

    // Expanding collapsed secondary workspace via keyboard reveals its links without leaking Workspace A's docs
    const collapseB = sidebar.getByRole('button', { name: 'Collapse Workspace Nghiên Cứu Hai Không Có Khoảng TrắngDài', exact: true })
    await toggleB.focus()
    await toggleB.press('ArrowRight')
    await expect(collapseB).toHaveAttribute('aria-expanded', 'true')
    await expect(sidebar.getByRole('navigation', { name: 'Workspace Nghiên Cứu Hai Không Có Khoảng TrắngDài' }).getByRole('link', { name: 'Plans', exact: true })).toBeVisible()
    await collapseB.press('ArrowLeft')
    await expect(toggleB).toHaveAttribute('aria-expanded', 'false')

    // Documents opens Library; Plans opens PLAN mode; Notes opens Notes flow
    await sidebar.getByRole('button', { name: 'Documents', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
    await sidebar.getByRole('button', { name: 'Plans', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Workspace assistant' })).toHaveAttribute('data-mode', 'PLAN')
    await sidebar.getByRole('button', { name: 'Notes', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible()
    await sidebar.getByRole('button', { name: 'Chats', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Workspace assistant' })).toHaveAttribute('data-mode', 'ASK')

    // Click document name opens Reader without checking checkbox; checkbox selects AI source without changing open doc
    const longOpenBtn = sidebar.getByRole('button', { name: longNoSpace, exact: true })
    await expect(longOpenBtn).toHaveAttribute('title', longNoSpace)
    const longCheckbox = sidebar.getByRole('checkbox', { name: longNoSpace, exact: true })
    const readyCheckbox = sidebar.getByRole('checkbox', { name: 'ready.pdf', exact: true })
    await longOpenBtn.click()
    await expect(page.getByRole('region', { name: 'Document preview' }).getByRole('button', { name: longNoSpace, exact: true })).toBeVisible()
    await expect(longCheckbox).not.toBeChecked()
    await readyCheckbox.check()
    await expect(sidebar.getByText('Sources · 1 of 3 active')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Document preview' }).getByRole('button', { name: longNoSpace, exact: true })).toBeVisible()

    // Drag sidebar to minimum width (180px), switch to Vietnamese, and verify zero horizontal overflow
    const sidebarResizer = page.getByRole('separator', { name: 'Resize navigation sidebar' })
    const sbHandle = (await sidebarResizer.boundingBox())!
    await page.mouse.move(sbHandle.x + sbHandle.width / 2, sbHandle.y + 120)
    await page.mouse.down()
    await page.mouse.move(sbHandle.x + sbHandle.width / 2 - 120, sbHandle.y + 120, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(180)

    await page.getByRole('button', { name: 'Tiếng Việt', exact: true }).click()
    await expect(sidebar.getByText('Đang xử lý')).toBeVisible()

    const overflowCheck = await sidebar.evaluate(aside => {
      const asideRect = aside.getBoundingClientRect()
      const offenders: string[] = []
      for (const el of aside.querySelectorAll('a, button, legend, .workspace-source, .badge, input, .design-icon')) {
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
        if (rect.right > asideRect.right + 1 || rect.left < asideRect.left - 1) {
          offenders.push(`${el.tagName}.${el.className}: ${rect.left}..${rect.right} vs ${asideRect.left}..${asideRect.right}`)
        }
      }
      const checkboxes = [...aside.querySelectorAll('input[type="checkbox"]')].map(cb => cb.getBoundingClientRect().width)
      const icons = [...aside.querySelectorAll('.workspace-source .design-icon')].map(ic => ic.getBoundingClientRect().width)
      return {
        scrollWidth: aside.scrollWidth,
        clientWidth: aside.clientWidth,
        offenders,
        minCheckbox: Math.min(...checkboxes),
        minIcon: Math.min(...icons),
      }
    })
    expect(overflowCheck.scrollWidth).toBeLessThanOrEqual(overflowCheck.clientWidth + 1)
    expect(overflowCheck.offenders).toEqual([])
    expect(overflowCheck.minCheckbox).toBeGreaterThanOrEqual(15.5)
    expect(overflowCheck.minIcon).toBeGreaterThanOrEqual(12)
    await page.screenshot({ path: 'test-results/sidebar-tree-180px.png' })

    await page.getByRole('button', { name: 'English', exact: true }).click()
    await sidebarResizer.dblclick()
    await expect.poll(async () => Math.round((await sidebar.boundingBox())!.width)).toBe(264)
    await page.screenshot({ path: 'test-results/sidebar-tree-desktop.png' })

    // Switching to secondary workspace isolates documents & selected sources
    await sidebar.getByRole('link', { name: 'Workspace Nghiên Cứu Hai Không Có Khoảng TrắngDài', exact: true }).click()
    await expect(sidebar.getByRole('checkbox', { name: 'workspace-b-only.pdf', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('checkbox', { name: 'ready.pdf', exact: true })).toHaveCount(0)
    await expect(sidebar.getByText('Sources · 0 of 1 active')).toBeVisible()
    await expect(sidebar.getByRole('button', { name: 'Collapse Workspace Nghiên Cứu Hai Không Có Khoảng TrắngDài', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(sidebar.getByRole('button', { name: 'Expand UI fixture workspace', exact: true })).toHaveAttribute('aria-expanded', 'false')

    // Returning to primary workspace restores its own checked source without leaking Workspace B docs
    await sidebar.getByRole('link', { name: 'UI fixture workspace', exact: true }).click()
    await expect(sidebar.getByRole('checkbox', { name: 'ready.pdf', exact: true })).toBeChecked()
    await expect(sidebar.getByRole('checkbox', { name: 'workspace-b-only.pdf', exact: true })).toHaveCount(0)
    await expect(sidebar.getByText('Sources · 1 of 3 active')).toBeVisible()

    // Mobile compact navigation works without page horizontal overflow
    await page.setViewportSize({ width: 375, height: 667 })
    await page.getByRole('tab', { name: 'Sources', exact: true }).click()
    await expect(page.locator('.workspace-compact-nav').getByRole('button', { name: 'Documents', exact: true })).toBeVisible()
    await expect(page.locator('.workspace-compact-nav').getByRole('button', { name: 'Plans', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
    await page.screenshot({ path: 'test-results/sidebar-tree-mobile.png' })
  } finally {
    await page.request.post(gw + '/__fixture/research', { data: { enabled: false, role: 'OWNER', broken: false, secondaryWorkspace: false } })
  }
})
