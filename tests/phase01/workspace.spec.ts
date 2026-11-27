import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const password = 'Phase1!a'

function planChoices(page: Page) {
  const group = page.getByRole('group', { name: 'Chat Learning Plan' })
  const checked = group.getByRole('radio', { checked: true })
  return {
    group,
    checked,
    async select(id: string) {
      const navigation = page.getByRole('button', { name: 'Show workspace navigation' })
      if (await navigation.isVisible() && !await group.isVisible()) await navigation.click()
      await expect(checked).toBeEnabled()
      const radio = group.locator(`input[value="${id}"]`)
      const more = group.getByRole('button', { name: /^Show more/ })
      if (!await radio.count() && await more.isVisible()) await more.click()
      await radio.click()
      await expect(checked).toHaveValue(id)
    },
  }
}

test.describe('Ask and Learning Plan core QA', () => {
  const workspace = process.env.ORCHID_QA_WORKSPACE
  const endpoint = '/v1/workspaces/' + workspace
  test.skip(process.env.CORE_QA !== '1' || !workspace || !process.env.ORCHID_QA_EMAIL,
    'Requires the synthetic core QA workspace')

  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in')
    await signIn(page, process.env.ORCHID_QA_EMAIL!)
    await page.route('**' + endpoint + '/runs', route => route.request().method() === 'POST'
      ? route.abort() : route.continue())
    await page.goto('/workspaces/' + workspace)
    await expect(planChoices(page).checked).toBeEnabled()
  })

  test('Learning Plan UI uses sidebar choices, grouped details and a scrollable Create preview', async ({ page, baseURL }, testInfo) => {
    const assistant = page.getByRole('region', { name: 'Workspace assistant' })
    const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' })
    const choices = planChoices(page)
    const manager = page.getByRole('region', { name: 'Learning Plans' })
    const planPath = endpoint + '/learning-plans'
    const title = 'UI Plan ' + randomUUID().slice(0, 8) + ' · Compare representations and explain how each example changes the result'
    async function createPlan(blueprint: object) {
      const response = await page.request.post(planPath, {
        headers: { Origin: baseURL!, 'Idempotency-Key': randomUUID() }, data: blueprint,
      })
      expect(response.status(), await response.text()).toBe(201)
      return response.json()
    }
    const oldPlans = await (await page.request.get(planPath)).json()
    for (let index = oldPlans.length; index < 4; index++) {
      await createPlan({ title: 'Synthetic sidebar example ' + randomUUID().slice(0, 8), days: 1,
        objectives: [{ day: 1, goal: 'Describe the example', activities: [] }] })
    }
    const long = await createPlan({ title, days: 6, objectives: [
      { day: 1, goal: 'Compare two shapes', activities: ['Draw the first pair'] },
      ...Array.from({ length: 6 }, (_, index) => ({ day: index + 1,
        goal: 'Describe and verify the representation for example ' + (index + 1), activities: ['Practice privately'] })),
    ] })
    const storedPath = planPath + '/' + long.plan_id
    const fixtureList = async (plans: object[]) => {
      await page.route('**' + planPath, route => route.fulfill({ json: plans }))
      await page.reload()
      await expect(choices.checked).toBeEnabled()
      await expect(choices.group.getByRole('radio')).toHaveCount(plans.length + 1)
      await expect(choices.checked).toHaveValue('')
      await page.unroute('**' + planPath)
    }
    await fixtureList([])
    await fixtureList([long])
    await page.reload()
    await expect(choices.group.getByRole('button', { name: /Show more/ })).toBeVisible()
    await expect(assistant.getByRole('combobox', { name: 'Learning Plan' })).toHaveCount(0)
    await expect(assistant.getByRole('combobox', { name: 'Citation Mode' })).toBeVisible()
    const source = sidebar.getByRole('checkbox').first()
    await source.check()
    await expect(choices.group.getByRole('radio')).toHaveCount(4)
    const more = choices.group.getByRole('button', { name: /Show more/ })
    await more.click()
    const lastPlan = choices.group.getByRole('radio').last()
    const lastId = await lastPlan.inputValue()
    await lastPlan.click()
    await expect(choices.checked).toHaveValue(lastId)
    await choices.group.getByRole('button', { name: 'Show less' }).click()
    await expect(choices.checked).toHaveValue(lastId)
    await expect(source).toBeChecked()
    await sidebar.getByRole('button', { name: 'Collapse chat plan choices' }).click()
    await expect(choices.group).toBeHidden()
    await expect(manager).toBeHidden()
    await sidebar.getByRole('button', { name: 'Expand chat plan choices' }).press('Enter')
    await expect(choices.checked).toBeVisible()
    await planChoices(page).select(long.plan_id)
    await expect(choices.checked).toHaveValue(long.plan_id)
    await sidebar.screenshot({ path: testInfo.outputPath('plan-selector-desktop.png') })
    await page.reload()
    await expect(choices.checked).toHaveValue(long.plan_id)
    await expect(assistant.locator('.chat-query')).toHaveCount(0)

    await sidebar.getByRole('button', { name: 'Learning Plans', exact: true }).click()
    await expect(choices.checked).toBeDisabled()
    await manager.getByRole('button', { name: title, exact: true }).click()
    const detail = manager.getByRole('region', { name: 'Plan detail' })
    const firstDay = detail.locator('details').filter({ has: page.locator('summary', { hasText: 'Day 1 · 2 objectives' }) })
    await expect(firstDay.getByRole('heading', { level: 3 })).toHaveText([
      'Compare two shapes', 'Describe and verify the representation for example 1',
    ])
    await expect(detail.getByRole('checkbox')).toHaveCount(0)
    await expect(detail.getByRole('progressbar')).toHaveAttribute('value', '0')
    await firstDay.locator('summary').click()
    await expect(firstDay.getByText('Draw the first pair')).toBeHidden()
    await firstDay.locator('summary').press('Enter')
    await expect(firstDay.getByText('Draw the first pair')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('plan-details-desktop.png') })

    await detail.getByRole('button', { name: 'Edit plan' }).click()
    const names = manager.getByLabel('Plan name')
    const duration = manager.getByRole('combobox', { name: 'Days', exact: true })
    await names.focus()
    await page.screenshot({ path: testInfo.outputPath('plan-editor-desktop.png') })
    await names.fill(title + ' · edited')
    await duration.selectOption('7')
    await manager.getByRole('button', { name: 'Save plan' }).click()
    await expect(manager.getByRole('alert')).toBeVisible()
    await expect(names).toHaveValue(title + ' · edited')
    expect((await (await page.request.get(storedPath)).json()).state_revision).toBe(1)
    await duration.selectOption('6')
    await manager.getByRole('button', { name: 'Save plan' }).click()
    await expect(detail.getByRole('heading', { name: title + ' · edited' })).toBeVisible()
    await detail.getByRole('button', { name: 'Edit plan' }).click()
    await manager.getByRole('checkbox', { name: 'Completed' }).first().check()
    await manager.getByRole('button', { name: 'Save plan' }).click()
    await expect(detail.getByRole('progressbar')).toHaveAttribute('value', '1')
    const saved = await (await page.request.get(storedPath)).json()
    expect(saved).toMatchObject({ content_version: 2, state_revision: 3 })
    expect(saved.blueprint.objectives.map(item => item.id)).toEqual(long.blueprint.objectives.map(item => item.id))
    await detail.getByRole('button', { name: 'Edit plan' }).click()
    await names.fill('Discard this title')
    await manager.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(detail.getByRole('heading', { name: title + ' · edited' })).toBeVisible()
    expect((await (await page.request.get(storedPath)).json()).state_revision).toBe(3)

    await sidebar.getByRole('button', { name: 'Chats', exact: true }).click()
    await expect(choices.checked).toHaveValue(long.plan_id)
    const runId = randomUUID()
    const run = { run_id: runId, interaction: 'ASK', status: 'succeeded', query: 'Preview the six days',
      result: { claims: [], insufficient_evidence: false, learning_reply: 'Saved creation reply.', learning_plan_id: long.plan_id } }
    let submissions = 0
    await page.route('**' + endpoint + '/runs', route => {
      if (route.request().method() !== 'POST') return route.fallback()
      submissions++
      expect(route.request().postDataJSON().learning_action).toBe('create')
      return route.fulfill({ status: 202, json: run })
    })
    await page.route('**' + endpoint + '/runs/' + runId, route => route.fulfill({ json: run }))
    await assistant.getByLabel('Question or objective').fill('/plan Preview the six days')
    await assistant.getByRole('button', { name: 'Send', exact: true }).click()
    const card = assistant.getByRole('region', { name: 'Created Learning Plan' })
    const preview = card.getByRole('region', { name: 'Current Learning Plan preview' })
    const openPlan = card.getByRole('button', { name: 'Open Learning Plan' })
    await expect(assistant.getByText('Saved creation reply.')).toBeVisible()
    await expect(preview.getByText('Day 6', { exact: true })).toBeAttached()
    await expect(preview.getByText('Practice privately')).toHaveCount(0)
    await expect(preview.getByRole('checkbox')).toHaveCount(0)
    await expect(preview.getByRole('listitem')).toHaveCount(7)
    await expect(preview.locator('button')).toHaveCount(0)
    expect(await preview.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await card.screenshot({ path: testInfo.outputPath('create-preview-desktop.png') })
    await preview.press('End')
    await expect.poll(() => preview.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(preview.getByText('Describe and verify the representation for example 6')).toBeInViewport()
    await expect(manager).toBeHidden()

    await page.setViewportSize({ width: 390, height: 844 })
    await preview.press('Home')
    await expect.poll(() => preview.evaluate(element => element.scrollTop)).toBe(0)
    await card.screenshot({ path: testInfo.outputPath('create-preview-mobile.png') })
    await page.getByRole('button', { name: 'Show workspace navigation' }).click()
    await expect(choices.group.getByRole('radio', { name: 'No Plan' })).toBeVisible()
    await choices.group.getByRole('radio', { name: 'No Plan' }).click()
    await expect(choices.checked).toHaveValue('')
    await sidebar.screenshot({ path: testInfo.outputPath('plan-selector-mobile.png') })
    await page.getByRole('button', { name: 'Hide workspace navigation' }).click()
    await openPlan.click()
    await expect(detail.getByRole('heading', { name: title + ' · edited' })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('plan-details-mobile.png') })
    await page.route('**' + storedPath, route => route.fulfill({ status: 404, json: {} }))
    await page.getByRole('tab', { name: 'Assistant' }).click()
    await expect(card.getByText('The created Learning Plan is unavailable.')).toBeVisible()
    await expect(openPlan).toHaveCount(0)
    await expect(assistant.getByText('Saved creation reply.')).toBeVisible()
    expect(submissions).toBe(1)
  })

  test('Study Duration is visible before sending and stays out of history', async ({ page }, testInfo) => {
    const assistant = page.getByRole('region', { name: 'Workspace assistant' })
    const query = assistant.getByLabel('Question or objective')
    const duration = assistant.getByRole('group', { name: 'How many days would you like to study?' })
    const requests: { learning_action: string; learning_days?: number; objective: { query: string } }[] = []
    const runs = new Map<string, object>()
    await page.route('**' + endpoint + '/runs', route => {
      if (route.request().method() !== 'POST') return route.fallback()
      const data = route.request().postDataJSON()
      requests.push(data)
      const run = { run_id: randomUUID(), interaction: 'ASK', status: 'succeeded', query: data.objective.query,
        result: { claims: [], insufficient_evidence: false, learning_reply: 'Fixture reply.' } }
      runs.set(run.run_id, run)
      return route.fulfill({ status: 202, json: run })
    })
    await page.route('**' + endpoint + '/runs/*', route => {
      const run = runs.get(new URL(route.request().url()).pathname.split('/').at(-1)!)
      return run ? route.fulfill({ json: run }) : route.fallback()
    })

    const remove = assistant.getByRole('button', { name: 'Remove Learning Plan command' })
    await expect(duration).toHaveCount(0)
    await query.fill('/edit-plan Revise the topic')
    await expect(remove).toContainText('/edit-plan')
    await expect(duration).toHaveCount(0)
    await query.fill('/plan Compare fractions')
    await expect(duration.getByRole('radio', { name: 'Auto' })).toBeChecked()
    await duration.getByRole('radio', { name: '2 days' }).check()
    await duration.getByRole('radio', { name: '7 days' }).check()
    await expect(duration.getByRole('radio', { name: '7 days' })).toBeChecked()
    await duration.screenshot({ path: testInfo.outputPath('study-duration-desktop.png') })
    await remove.click()
    await expect(query).toHaveValue('Compare fractions')
    await expect(duration).toHaveCount(0)
    await query.fill('/plan Compare fractions')
    await expect(duration.getByRole('radio', { name: 'Auto' })).toBeChecked()
    await page.setViewportSize({ width: 390, height: 844 })
    await duration.screenshot({ path: testInfo.outputPath('study-duration-mobile.png') })
    expect(await duration.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    expect(requests).toEqual([])
    const send = assistant.getByRole('button', { name: 'Send', exact: true })
    await send.click()
    await expect(assistant.getByText('Fixture reply.')).toBeVisible()
    await expect(query).toHaveValue('')
    await expect(duration).toHaveCount(0)
    expect(requests[0]).toMatchObject({ learning_action: 'create', objective: { query: 'Compare fractions' } })
    expect(requests[0]).not.toHaveProperty('learning_days')
    await query.fill('/plan Practice addition')
    await expect(duration.getByRole('radio', { name: 'Auto' })).toBeChecked()
    await duration.getByRole('radio', { name: '3 days' }).check()
    await send.click()
    await expect(query).toHaveValue('')
    await expect(duration).toHaveCount(0)
    expect(requests[1]).toMatchObject({ learning_action: 'create', learning_days: 3,
      objective: { query: 'Practice addition' } })
    await expect(assistant.locator('.chat-query')).toHaveText(['Practice addition'])
  })

  test('restores saved conversation, Plan selection and progress after reload', async ({ page, baseURL }, testInfo) => {
    const planId = 'c0910000-0000-4000-8000-000000000001'
    const chatA = 'c0910000-0000-4000-8000-000000000003'
    const chatB = 'c0910000-0000-4000-8000-000000000004'
    const planPath = endpoint + '/learning-plans/' + planId
    const saved = async (url: string) => {
      const response = await page.request.get(url)
      expect(response.ok(), `GET ${url}`).toBe(true)
      return response.json()
    }
    const plan = await saved(planPath)
    if (plan.blueprint.objectives[0].progress !== 'completed') {
      plan.blueprint.objectives[0].progress = 'completed'
      const response = await page.request.put(planPath, { headers: { Origin: baseURL! },
        data: { revision: plan.state_revision, blueprint: plan.blueprint } })
      expect(response.ok(), await response.text()).toBe(true)
    }
    const snapshot = async () => ({
      plan: await saved(planPath),
      a: await saved(endpoint + '/conversations/' + chatA + '/learning-plan'),
      b: await saved(endpoint + '/conversations/' + chatB + '/learning-plan'),
    })
    const before = await snapshot()
    expect(before.a.selected_plan_id).toBe(planId)
    expect(before.b.selected_plan_id).toBeNull()
    expect(before.b.selection_revision).toBeGreaterThan(0)
    expect(before.plan.blueprint.objectives[0].progress).toBe('completed')
    const assistant = page.getByRole('region', { name: 'Workspace assistant' })
    const selector = planChoices(page).checked
    const nav = (name: string) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first()
    const open = async (letter: string) => {
      await nav('History').click()
      await assistant.getByRole('button', { name: `Core restore chat ${letter}`, exact: true }).click()
      await expect(assistant.getByText(`Retained answer ${letter}`, { exact: true })).toBeVisible()
      await nav('Chats').click()
    }
    const record = async (label: string, state: Awaited<ReturnType<typeof snapshot>>) => {
      const selectedPlan = await selector.inputValue()
      const path = testInfo.outputPath(label + '.json')
      await writeFile(path, JSON.stringify({ route: new URL(page.url()).pathname, selectedPlan, state }, null, 2))
      await testInfo.attach(label, { path, contentType: 'application/json' })
    }

    await expect(selector).toHaveValue('')
    await open('A')
    await expect(selector).toHaveValue(planId)
    await record('before', before)
    await page.reload()
    const after = await snapshot()
    expect(after).toEqual(before)
    await expect(assistant.getByText('Retained answer A', { exact: true })).toBeVisible()
    await expect(selector).toHaveValue(planId)
    await record('after', after)
    await nav('Learning Plans').click()
    await page.getByRole('region', { name: 'Learning Plans' }).getByRole('button', { name: 'Core persistence sample' }).click()
    await expect(page.getByRole('progressbar')).toHaveAttribute('value', '1')
    await nav('Chats').click()
    await open('B')
    await expect(selector).toHaveValue('')
    await page.reload()
    await expect(assistant.getByText('Retained answer B', { exact: true })).toBeVisible()
    await expect(selector).toHaveValue('')
    await assistant.getByRole('button', { name: 'New chat', exact: true }).click()
    await page.reload()
    await expect(selector).toBeEnabled()
    await expect(selector).toHaveValue('')
    await expect(assistant.getByText('Retained answer B', { exact: true })).toHaveCount(0)
    await open('A')
    await expect(selector).toHaveValue(planId)
    expect(await snapshot()).toEqual(before)
  })
})

test('Ask evidence gaps render and copy as part of the assistant reply', async ({ page }, testInfo) => {
  const workspace = process.env.ORCHID_QA_WORKSPACE
  const email = process.env.ORCHID_QA_EMAIL
  test.skip(!workspace || !email, 'Requires the existing synthetic QA workspace')
  await page.goto('/sign-in')
  await signIn(page, email!)
  const endpoint = '/v1/workspaces/' + workspace
  const documents = await (await page.request.get(endpoint + '/documents')).json()
  const document = documents.find(item => item.filename.startsWith('01_'))
  expect(document).toBeTruthy()

  const supported = 'Orchid uses 420-token chunks.'
  const gap = 'The selected documents do not specify the GPU.'
  const noEvidenceQuestion = 'Which GPU was used?'
  const mixedQuestion = 'What chunk size and GPU were used?'
  const fixtureRuns = new Map<string, object>()
  await page.route('**' + endpoint + '/runs', async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.continue()
    const { objective } = request.postDataJSON()
    expect([noEvidenceQuestion, mixedQuestion]).toContain(objective.query)
    const mixed = objective.query === mixedQuestion
    const runId = randomUUID()
    const run = {
      run_id: runId, interaction: 'ASK', status: 'succeeded', step: 'compose', query: objective.query,
      result: {
        source_state: 'found', insufficient_evidence: !mixed, unsupported_parts: [gap],
        claims: mixed ? [{ text: supported, source: 'document', citations: [{
          document_id: document.document_id, chunk_id: randomUUID(), name: document.filename, page: 2,
        }] }] : [],
      },
    }
    fixtureRuns.set(runId, run)
    await route.fulfill({ status: 202, json: run })
  })
  await page.route('**' + endpoint + '/runs/*', route => {
    const run = fixtureRuns.get(new URL(route.request().url()).pathname.split('/').at(-1)!)
    return run ? route.fulfill({ json: run }) : route.continue()
  })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/workspaces/' + workspace)
  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await page.getByRole('checkbox', { name: document.filename, exact: true }).check()
  for (const question of [noEvidenceQuestion, mixedQuestion]) {
    const mixed = question === mixedQuestion
    await assistant.getByLabel('Question or objective').fill(question)
    await assistant.getByRole('button', { name: 'Send', exact: true }).click()
    const response = assistant.locator('article').filter({ hasText: question }).locator('.assistant-response')
    await expect(response.getByText(gap, { exact: true })).toBeVisible()
    const citation = response.locator('.claim-row').getByRole('button', { name: document.filename + ', page 2' })
    await expect(citation).toHaveCount(mixed ? 1 : 0)
    await expect(response.getByText('Save as artifact', { exact: true })).toHaveCount(mixed ? 1 : 0)
    await response.getByRole('button', { name: 'Copy', exact: true }).click()
    const expected = mixed ? supported + ' (' + document.filename + ', page 2)\n\n' + gap : gap
    await expect.poll(async () => (await page.evaluate(() => navigator.clipboard.readText()))
      .replaceAll('\r\n', '\n')).toBe(expected)
    if (mixed) {
      await expect(response.locator('.claim-copy, .assistant-evidence-gap')).toHaveText([supported, gap])
      await response.getByText('Save as artifact', { exact: true }).click()
      await expect(response.getByText('Only document-supported claims are saved.')).toBeVisible()
      await page.setViewportSize({ width: 390, height: 844 })
    }
    await response.screenshot({ path: testInfo.outputPath(mixed ? 'partial-mobile.png' : 'insufficient-desktop.png') })
  }
  expect(fixtureRuns.size).toBe(2)
})

test('Orchid live Owner Preview samples Ask and Learning Plan', async ({ page, baseURL }, testInfo) => {
  const corpus = process.env.ORCHID_QA_CORPUS
  test.skip(!corpus, 'Requires the authorized live QA stack and Orchid synthetic corpus')
  test.setTimeout(720000)
  const reused = process.env.ORCHID_QA_WORKSPACE
  if (reused) {
    await page.goto('/sign-in')
    await signIn(page, process.env.ORCHID_QA_EMAIL!)
  } else {
    await signUp(page, `orchid-qa-${randomUUID()}@example.com`)
  }
  const headers = () => ({ Origin: baseURL!, 'Idempotency-Key': randomUUID() })
  let workspace = reused
  if (!workspace) {
    const created = await page.request.post('/v1/workspaces', { headers: headers(), data: { name: 'Orchid corrective QA' } })
    expect(created.status()).toBe(201)
    workspace = (await created.json()).workspace_id
  }
  const endpoint = '/v1/workspaces/' + workspace
  const names = (await readdir(corpus!)).filter(name => name.endsWith('.pdf')).sort()
  const ids = []
  const existing = await (await page.request.get(endpoint + '/documents')).json()
  expect(names).toHaveLength(3)
  for (const name of names) {
    const retained = existing.find(item => item.filename === name)
    if (retained) {
      ids.push(retained.document_id)
      continue
    }
    const upload = await page.request.post(endpoint + '/documents', {
      headers: { ...headers(), 'Content-Type': 'application/octet-stream', 'X-Filename': name },
      data: await readFile(join(corpus!, name)),
    })
    expect(upload.status(), await upload.text()).toBe(201)
    ids.push((await upload.json()).document_id)
  }
  for (const id of ids) {
    await expect.poll(async () => {
      const jobs = await (await page.request.get(endpoint + '/documents/' + id + '/jobs')).json()
      return Array.isArray(jobs) && jobs.some(job => job.kind === 'index' && job.status === 'succeeded')
    }, { timeout: 240000, intervals: [1000, 3000, 5000] }).toBe(true)
  }
  await page.goto('/workspaces/' + workspace)
  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  const query = assistant.getByLabel('Question or objective')
  const selector = planChoices(page).checked
  await expect(selector).toBeEnabled()
  await expect(assistant.getByRole('combobox', { name: 'Capability', exact: true })).toHaveCount(0)
  await expect(assistant.getByRole('combobox', { name: 'Output', exact: true })).toHaveCount(0)
  for (const name of names) {
    await page.getByRole('complementary', { name: 'Workspace navigation' })
      .getByRole('checkbox', { name, exact: true }).check()
  }
  await assistant.getByRole('combobox', { name: 'Citation Mode' }).selectOption('chunk')
  async function send(question: string) {
    await query.fill(question)
    const submit = assistant.getByRole('button', { name: 'Send', exact: true })
    await expect(submit).toBeEnabled()
    const submission = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(endpoint + '/runs'))
    await submit.click()
    const response = await submission
    expect(response.status(), await response.text()).toBe(202)
    const queued = await response.json()
    let run = queued
    await expect.poll(async () => {
      run = await (await page.request.get(endpoint + '/runs/' + queued.run_id)).json()
      return run.status
    }, { timeout: 100000 }).toMatch(/succeeded|failed|cancelled/)
    const summary = { run: run.run_id, request: run.request_id, status: run.status, error: run.error_code,
      answer: run.result?.claims?.map(item => ({ text: item.text, source: item.source,
        citations: item.citations.map(c => [c.name, c.page, c.segment_ids?.length ?? 0]) })),
      unsupported: run.result?.unsupported_parts, card: run.result?.learning_card }
    console.log(JSON.stringify(summary))
    expect(run.status, JSON.stringify(summary)).toBe('succeeded')
    await expect(query).toBeEnabled()
    return run
  }
  if (process.env.ORCHID_QA_ROUND2) {
    const sources = names.map(name => page.getByRole('complementary', { name: 'Workspace navigation' })
      .getByRole('checkbox', { name, exact: true }))
    const setSources = async (checked: boolean) => {
      for (const source of sources) await source.setChecked(checked)
    }
    const newChat = assistant.getByRole('button', { name: 'New chat', exact: true })
    if (await newChat.isVisible()) await newChat.click()
    await expect(selector).toHaveValue('')
    await setSources(true)
    const textClaims = (run) => run.result.claims.map(claim => claim.text).join(' ')
    const provenance = (run) => run.result.claims.map(claim => claim.source)
    const gaps = (run) => (run.result.unsupported_parts ?? []).join(' ')
    const turn = (question: string) => assistant.locator('article').filter({ hasText: question }).last()
    const noPlan = (run) => {
      expect.soft(run.result.claims).toEqual([])
      expect.soft(gaps(run)).toMatch(/chưa chọn|không có.{0,35}(kế hoạch|lộ trình)/i)
      expect.soft(run.result.learning_card).toBeFalsy()
    }
    const noCard = (run) => expect.soft(run.result.learning_card).toBeFalsy()
    const fact = (run) => {
      expect.soft(textClaims(run)).toMatch(/420/)
      expect.soft(textClaims(run)).toMatch(/60/)
      expect.soft(run.result.claims.flatMap(claim => claim.citations)
        .some(citation => citation.name === names[0] && citation.page === 2)).toBe(true)
    }
    const mixedQuestion = 'Orchid chia chunk bao nhiêu token, overlap bao nhiêu, và dùng GPU nào để huấn luyện?'
    const comparisonQuestion = 'Giữa Cedar và Birch, ứng viên nào đủ điều kiện deployment? Tại sao?'
    const checkMixed = (run) => {
      fact(run)
      expect.soft(gaps(run)).toMatch(/GPU/i)
      expect.soft(gaps(run)).not.toMatch(/chi phí/i)
      expect.soft(provenance(run)).toContain('document')
    }
    const checkComparison = (run) => {
      const answer = textClaims(run)
      expect.soft(answer).toMatch(/Cedar/i)
      expect.soft(answer).toMatch(/Birch/i)
      expect.soft(answer).toMatch(/94\s*%/)
      expect.soft(answer).toMatch(/95\s*%/)
      expect.soft(answer).toMatch(/4[.,]2/)
      expect.soft(answer).toMatch(/4[.,]5/)
      expect.soft(answer).toMatch(/Cedar.{0,100}(?:đủ điều kiện|đạt)|(?:đủ điều kiện|đạt).{0,100}Cedar/i)
      expect.soft(answer).toMatch(/Birch.{0,110}(?:không đủ|không đạt|không đáp ứng)|(?:không đủ|không đạt|không đáp ứng).{0,70}Birch/i)
      expect.soft(new Set(run.result.claims.flatMap(claim => claim.citations
        .filter(citation => citation.name === names[2]).map(citation => citation.page)))).toEqual(new Set([1, 2]))
    }
    const absentQuestion = 'Orchid sử dụng loại GPU nào để huấn luyện mô hình và tổng chi phí huấn luyện là bao nhiêu?'
    const absent = await send(absentQuestion)
    expect.soft(absent.result.claims).toEqual([])
    expect.soft(absent.result.insufficient_evidence).toBe(true)
    expect.soft(gaps(absent)).toMatch(/GPU/i)
    expect.soft(gaps(absent)).toMatch(/chi phí/i)
    await expect.soft(turn(absentQuestion).locator('.assistant-response').getByText(/GPU/i).first()).toBeVisible()
    await expect.soft(turn(absentQuestion).getByRole('alert')).toHaveCount(0)
    await turn(absentQuestion).screenshot({ path: testInfo.outputPath('insufficient-evidence.png') })

    if (process.env.ORCHID_QA_ROUND2 === 'targeted') {
      checkMixed(await send(mixedQuestion))
      await turn(mixedQuestion).screenshot({ path: testInfo.outputPath('partial-evidence.png') })
      await newChat.click()
      checkComparison(await send(comparisonQuestion))
      await turn(comparisonQuestion).screenshot({ path: testInfo.outputPath('deployment-comparison.png') })
      return
    }

    const factQuestion = 'Orchid sử dụng chunk size và overlap bao nhiêu token?'
    const supported = await send(factQuestion)
    fact(supported)
    expect.soft(gaps(supported)).toEqual('')
    const chunk = turn(factQuestion).getByRole('button', { name: names[0] + ', page 2', exact: true }).first()
    if (await chunk.isVisible()) {
      await chunk.click()
      await expect.soft(page.getByLabel('Citation highlight').first()).toBeVisible()
    }
    await assistant.getByRole('combobox', { name: 'Citation Mode' }).selectOption('segment')
    const mixed = await send(mixedQuestion)
    checkMixed(mixed)
    expect.soft(mixed.result.claims.flatMap(claim => claim.citations)
      .some(citation => citation.segment_ids?.length)).toBe(true)
    const segment = assistant.getByRole('button', { name: names[0] + ', page 2', exact: true }).last()
    if (await segment.isVisible()) {
      await segment.click()
      await expect.soft(page.getByLabel('Citation highlight').first()).toBeVisible()
    }
    await assistant.getByRole('combobox', { name: 'Citation Mode' }).selectOption('chunk')
    const day = 'Theo kế hoạch học đang được chọn, ngày thứ hai tôi cần học gì?'
    noPlan(await send(day))
    const broad = await send('Hãy phân tích cách Orchid truy hồi tài liệu, đảm bảo citation chính xác và đánh giá điều kiện deployment.')
    expect.soft(new Set(broad.result.claims.flatMap(claim => claim.citations.map(citation => citation.name))))
      .toEqual(new Set(names))
    checkComparison(await send(comparisonQuestion))

    await newChat.click()
    await setSources(false)
    await expect(selector).toHaveValue('')
    const plans = await (await page.request.get(endpoint + '/learning-plans')).json()
    const plan = plans.find(item => item.blueprint.title === 'RAG Engineering Lab')
    expect(plan).toBeTruthy()
    const planPath = endpoint + '/learning-plans/' + plan.plan_id
    const first = plan.blueprint.objectives.find(item => item.day === 1)
    await planChoices(page).select(plan.plan_id)
    await expect(selector).toHaveValue(plan.plan_id)
    const selected = await send(day)
    expect.soft(new Set(provenance(selected))).toEqual(new Set(['plan']))
    expect.soft(textClaims(selected)).toMatch(/trích dẫn|chứng thực/i)
    const repeatDay = 'Nhắc lại mục tiêu của ngày 2 trong Plan này và các hoạt động trong ngày.'
    const planRepeat = await send(repeatDay)
    expect.soft(new Set(provenance(planRepeat))).toEqual(new Set(['plan']))
    await expect.soft(turn(repeatDay).getByText('From your Learning Plan', { exact: true }).first()).toBeVisible()
    await turn(repeatDay).screenshot({ path: testInfo.outputPath('plan-provenance.png') })

    await setSources(true)
    const teaching = 'Dựa vào mục tiêu học tập ngày đầu tiên và các tài liệu đã cung cấp, hãy hướng dẫn tôi học nội dung của ngày này.'
    const lesson = await send(teaching)
    noCard(lesson)
    expect.soft(provenance(lesson)).toContain('plan')
    expect.soft(provenance(lesson)).toContain('document')
    expect.soft(textClaims(lesson).length).toBeGreaterThan(80)
    await expect.soft(turn(teaching).getByRole('heading', { name: 'Completion Suggestion' })).toHaveCount(0)
    await turn(teaching).screenshot({ path: testInfo.outputPath('teaching-without-completion.png') })
    noCard(await send('OK, mình đọc rồi.'))
    const assessment = 'Mình hiểu BM25 tìm khớp từ khóa, dense tìm theo ý nghĩa. Orchid lấy 12 ứng viên từ mỗi nhánh, hợp nhất xếp hạng bằng RRF k=60, xếp hạng lại top 8 rồi chọn 3 đoạn. Chunk 420 token, overlap 60 token và không vượt qua ranh giới trang. Giải thích của mình đã đáp ứng mục tiêu ngày 1 chưa?'
    const mastery = await send(assessment)
    expect.soft(mastery.result.learning_card).toBeTruthy()
    if (mastery.result.learning_card) {
      const card = turn(assessment).getByRole('region', { name: 'Learning Plan suggestion' })
      await expect.soft(card.getByRole('heading', { name: 'Completion Suggestion' })).toBeVisible()
      await expect.soft(card.getByText(first.goal, { exact: false })).toBeVisible()
      const data = await (await page.request.get(endpoint + '/learning-cards/' + mastery.result.learning_card)).json()
      expect.soft(data.payload.proposal.objectives.filter(item => item.progress === 'completed').map(item => item.id))
        .toEqual([first.id])
      await card.screenshot({ path: testInfo.outputPath('eligible-completion.png') })
      await card.getByRole('button', { name: 'Reject', exact: true }).click()
      await expect.soft(card.getByText('Suggestion rejected.')).toBeVisible()
    }
    expect.soft((await (await page.request.get(planPath)).json()).state_revision).toBe(plan.state_revision)

    await setSources(false)
    await planChoices(page).select('')
    await expect(selector).toHaveValue('')
    noPlan(await send(day))
    const historyRecall = await send('Hãy nhắc lại câu hỏi tôi vừa gửi, không cần trả lời lại câu hỏi đó.')
    expect.soft(provenance(historyRecall)).toContain('conversation')
    expect.soft(textClaims(historyRecall)).toMatch(/ngày thứ hai|ngày 2/i)
    return
  }
  if (process.env.ORCHID_QA_RETEST) {
    const multi = await send('Hãy phân tích cách Orchid truy hồi tài liệu, đảm bảo citation chính xác và đánh giá điều kiện deployment.')
    const candidate = await send('Giữa Cedar và Birch, ứng viên nào đủ điều kiện deployment? Tại sao?')
    const claims = (run) => run.result.claims.map(item => item.text).join(' ')
    const cited = (run) => new Set(run.result.claims.flatMap(item => item.citations.map(c => c.name)))
    expect.soft(claims(multi)).toMatch(/BM25|lexical search|tìm kiếm từ vựng/i)
    expect.soft(claims(multi)).toMatch(/dense|tìm kiếm ngữ nghĩa/i)
    expect.soft(cited(multi)).toEqual(new Set(names))
    expect.soft(claims(candidate)).toMatch(/Cedar/)
    expect.soft(claims(candidate)).toMatch(/Birch/)
    expect.soft(claims(candidate)).toMatch(/94\s*%/)
    expect.soft(claims(candidate)).toMatch(/95\s*%/)
    const pages = candidate.result.claims.flatMap(item => item.citations.filter(c => c.name === names[2]).map(c => c.page))
    expect.soft(new Set(pages)).toEqual(new Set([1, 2]))
    if (process.env.ORCHID_QA_RETEST === 'answers') return
    const plans = await (await page.request.get(endpoint + '/learning-plans')).json()
    const before = plans.find(item => item.blueprint.days === 3)
    expect(before).toBeTruthy()
    await planChoices(page).select(before.plan_id)
    await expect(selector).toHaveValue(before.plan_id)
    await expect(selector).toBeEnabled()
    for (const name of names) {
      await page.getByRole('complementary', { name: 'Workspace navigation' })
        .getByRole('checkbox', { name, exact: true }).uncheck()
    }
    const edited = await send('/edit-plan Chỉ đổi tên kế hoạch thành RAG Engineering Lab. Giữ nguyên ngày, mục tiêu, hoạt động và tiến độ.')
    const preview = assistant.getByRole('region', { name: 'Learning Plan suggestion' }).last()
    await expect(preview.getByText('After: RAG Engineering Lab')).toBeVisible()
    const card = await (await page.request.get(endpoint + '/learning-cards/' + edited.result.learning_card)).json()
    expect(card.payload.changes).toEqual([{ field: 'title', before: before.blueprint.title, after: 'RAG Engineering Lab' }])
    await preview.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(selector).toHaveAccessibleName('RAG Engineering Lab')
    await expect(selector).toHaveValue(before.plan_id)
    await page.screenshot({ path: testInfo.outputPath('orchid-live-after-accept.png') })
    await page.reload()
    await page.getByRole('button', { name: 'Learning Plans', exact: true }).filter({ visible: true }).first().click()
    await page.getByRole('button', { name: 'RAG Engineering Lab', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'RAG Engineering Lab' })).toBeVisible()
    return
  }
  const ask = await send('Orchid sử dụng chunk size và overlap bao nhiêu token?')
  const source = assistant.getByRole('button', { name: names[0] + ', page 2', exact: true }).last()
  if (ask.result.claims.some(item => item.citations.some(c => c.name === names[0] && c.page === 2))) {
    await source.click()
    await expect(page.getByLabel('Citation highlight').first()).toBeVisible()
  }
  await send('Hãy phân tích cách Orchid truy hồi tài liệu, đảm bảo citation chính xác và đánh giá điều kiện deployment.')
  await send('Giữa Cedar và Birch, ứng viên nào đủ điều kiện deployment? Tại sao?')
  await query.fill('/')
  await assistant.getByRole('button', { name: '/plan', exact: true }).click()
  await assistant.getByRole('radio', { name: '3 days', exact: true }).check()
  const generated = await send('Hãy xây dựng kế hoạch học RAG Engineering trong 3 ngày dựa trên các tài liệu tôi cung cấp.')
  const planId = generated.result.learning_plan_id
  const before = await (await page.request.get(endpoint + '/learning-plans/' + planId)).json()
  console.log(JSON.stringify({ create: before.blueprint, reply: generated.result.learning_reply }))
  const createdCard = assistant.getByRole('region', { name: 'Created Learning Plan' })
  await expect(createdCard.getByText('3 days', { exact: false })).toBeVisible()
  await expect(selector).toHaveValue(planId)
  await createdCard.getByRole('button', { name: 'Open Learning Plan' }).click()
  await expect(page.getByRole('heading', { name: before.blueprint.title })).toBeVisible()
  await page.getByRole('button', { name: 'Chats', exact: true }).filter({ visible: true }).first().click()
  const edited = await send('/edit-plan Bổ sung một hoạt động thực hành so sánh BM25 và Dense Retrieval vào ngày đầu tiên, giữ nguyên các mục tiêu còn lại.')
  const cardPath = endpoint + '/learning-cards/' + edited.result.learning_card
  const card = await (await page.request.get(cardPath)).json()
  console.log(JSON.stringify({ preview: card.payload.changes, reply: card.payload.reply }))
  const same = await (await page.request.get(endpoint + '/learning-plans/' + planId)).json()
  expect(same).toEqual(before)
  const preview = assistant.getByRole('region', { name: 'Learning Plan suggestion' }).last()
  await expect(preview.getByRole('heading', { name: 'Change Preview' })).toBeVisible()
  await preview.locator('summary').click()
  await preview.screenshot({ path: testInfo.outputPath('orchid-live-edit.png') })
  await preview.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(preview.getByText('Suggestion accepted.')).toBeVisible()
  const after = await (await page.request.get(endpoint + '/learning-plans/' + planId)).json()
  expect(after.blueprint).toEqual(card.payload.proposal)
  expect(after.state_revision).toBe(before.state_revision + 1)
  await expect(selector).toHaveAccessibleName(after.blueprint.title)
})

test('Learning Plan fixture stack indexes the corpus and integrates chat and authoring', async ({ page, baseURL }, testInfo) => {
  const corpus = process.env.LEARNING_PLAN_QA_CORPUS
  test.skip(!corpus, 'Requires the QA fixture stack and the prepared public corpus')
  test.setTimeout(600000)
  const reusedWorkspace = process.env.LEARNING_PLAN_QA_WORKSPACE
  if (reusedWorkspace) {
    if (!process.env.LEARNING_PLAN_QA_EMAIL) throw new Error('The existing QA workspace requires its synthetic owner email')
    await page.goto('/sign-in')
    await signIn(page, process.env.LEARNING_PLAN_QA_EMAIL)
  } else {
    await signUp(page, `plan-qa-${randomUUID()}@example.com`)
  }
  const headers = () => ({ Origin: baseURL!, 'Idempotency-Key': randomUUID() })
  let workspace = reusedWorkspace
  if (!workspace) {
    const created = await page.request.post('/v1/workspaces', { headers: headers(), data: { name: 'Learning Plan corpus QA' } })
    expect(created.status()).toBe(201)
    workspace = (await created.json()).workspace_id
  }
  const endpoint = '/v1/workspaces/' + workspace
  const names = (await readdir(corpus!)).filter(name => name.endsWith('.pdf')).sort()
  expect(names).toHaveLength(3)
  const uploads: { name: string; id: string }[] = []
  const existing = reusedWorkspace ? await (await page.request.get(endpoint + '/documents')).json() : []
  for (const name of names) {
    const found = existing.find(item => item.filename === name)
    if (found) {
      uploads.push({ name, id: found.document_id })
      continue
    }
    const upload = await page.request.post(endpoint + '/documents', {
      headers: { ...headers(), 'Content-Type': 'application/octet-stream', 'X-Filename': name },
      data: await readFile(join(corpus!, name)),
    })
    expect(upload.status(), await upload.text()).toBe(201)
    uploads.push({ name, id: (await upload.json()).document_id })
  }
  for (const { id } of uploads) {
    await expect.poll(async () => {
      const response = await page.request.get(endpoint + '/documents/' + id + '/jobs')
      const jobs = await response.json()
      return Array.isArray(jobs) && jobs.some(job => job.kind === 'index' && job.status === 'succeeded')
    }, { timeout: 240000, intervals: [1000, 2000, 5000] }).toBe(true)
  }
  await testInfo.attach('corpus-documents', { body: JSON.stringify({ workspace, uploads }), contentType: 'application/json' })
  await page.goto('/workspaces/' + workspace)
  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await expect(assistant).toBeVisible()
  const plan = planChoices(page).checked
  const input = assistant.getByLabel('Question or objective')
  const document = page.getByRole('complementary', { name: 'Workspace navigation' })
    .getByRole('checkbox', { name: uploads[0].name, exact: true })
  const send = async (query: string) => {
    await input.fill(query)
    const submitted = page.waitForResponse(response => response.request().method() === 'POST'
      && response.url().endsWith(endpoint + '/runs'))
    await assistant.getByRole('button', { name: 'Send', exact: true }).click()
    const accepted = await submitted
    expect(accepted.status(), await accepted.text()).toBe(202)
    const queued = await accepted.json()
    let run = queued
    await expect.poll(async () => {
      run = await (await page.request.get(endpoint + '/runs/' + queued.run_id)).json()
      return run.status
    }, { timeout: 60000 }).toBe('succeeded')
    await expect(input).toBeEnabled()
    return run
  }
  await expect(plan).toHaveValue('')
  await document.check()
  const chunk = assistant.getByRole('combobox', { name: 'Citation Mode' })
  await chunk.selectOption('chunk')
  const sourced = await send('How does FastText represent words?')
  expect(sourced.result.claims.some(claim => claim.citations.some(citation => citation.document_id === uploads[0].id))).toBe(true)
  await assistant.getByRole('button', { name: new RegExp('^' + uploads[0].name) }).last().click()
  await expect(page.getByLabel('Citation highlight').first()).toBeVisible()
  await document.uncheck()
  const unsourced = await send('How can I start studying embeddings?')
  expect(unsourced.result.source_state).toBe('zero')
  await input.fill('/plan ')
  await assistant.getByRole('radio', { name: '2 days', exact: true }).check()
  const generation = await send('Study embeddings in two days')
  await expect(plan).toHaveValue(generation.result.learning_plan_id)
  const planResponse = await page.request.get(endpoint + '/learning-plans/' + generation.result.learning_plan_id)
  expect((await planResponse.json()).blueprint.days).toBe(2)
  const selected = await send('What plan did I select?')
  expect(selected.result.claims.some(claim => claim.source === 'plan')).toBe(true)
  await document.check()
  await chunk.selectOption('segment')
  const mixed = await send('Use my plan and the selected source.')
  expect(mixed.result.source_state).toBe('found')
  const citation = mixed.result.claims.flatMap(claim => claim.citations)[0]
  expect(citation.document_id).toBe(uploads[0].id)
  await assistant.getByRole('button', { name: new RegExp('^' + uploads[0].name) }).last().click()
  await expect(page.getByLabel('Citation highlight').first()).toBeVisible()
  await document.uncheck()
  await send('/edit-plan Improve the title')
  const preview = assistant.getByRole('region', { name: 'Learning Plan suggestion' }).last()
  await expect(preview.getByRole('heading', { name: 'Change Preview' })).toBeVisible()
  await expect(preview.getByText('After: Updated fixture learning plan')).toBeVisible()
  await preview.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(preview.getByText('Suggestion accepted.')).toBeVisible()
  await send('I completed my first objective.')
  const completion = assistant.getByRole('region', { name: 'Learning Plan suggestion' }).last()
  await expect(completion.getByRole('heading', { name: 'Completion Suggestion' })).toBeVisible()
  await completion.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(completion.getByText('Suggestion accepted.')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('learning-plan-integrated-desktop.png') })
  await page.reload()
  await page.getByRole('button', { name: 'History', exact: true }).filter({ visible: true }).first().click()
  await assistant.getByRole('button', { name: 'How does FastText represent words?', exact: true }).first().click()
  await page.getByRole('button', { name: 'Chats', exact: true }).filter({ visible: true }).first().click()
  await expect(plan).toHaveValue(generation.result.learning_plan_id)
  await assistant.getByRole('button', { name: 'New chat', exact: true }).click()
  await expect(plan).toHaveValue('')
})

test('Learning Plan mobile Change Preview supports keyboard rejection and preserves state', async ({ page, baseURL }, testInfo) => {
  const workspace = process.env.LEARNING_PLAN_QA_WORKSPACE
  const email = process.env.LEARNING_PLAN_QA_EMAIL
  test.skip(!workspace || !email, 'Requires an existing indexed fixture QA workspace')
  await page.goto('/sign-in')
  await signIn(page, email!)
  const base = '/v1/workspaces/' + workspace
  const title = 'Mobile preview ' + randomUUID().slice(0, 8)
  const response = await page.request.post(base + '/learning-plans', {
    headers: { Origin: baseURL!, 'Idempotency-Key': randomUUID() },
    data: { title, days: 1, objectives: [{ day: 1, goal: 'Compare representations', activities: ['Draw a diagram.'] }] },
  })
  expect(response.status(), await response.text()).toBe(201)
  const identifier = (await response.json()).plan_id
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/workspaces/' + workspace)
  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  const selector = planChoices(page).checked
  const selectionWrite = page.waitForResponse(result =>
    result.request().method() === 'POST' && result.url().endsWith(base + '/conversations'))
  await planChoices(page).select(identifier)
  const selected = await selectionWrite
  expect(selected.status(), await selected.text()).toBe(201)
  await expect(selector).toHaveValue(identifier)
  await expect(selector).toBeEnabled()
  const query = assistant.getByLabel('Question or objective')
  await query.fill('/edit-plan Rename the plan')
  await assistant.getByRole('button', { name: 'Send', exact: true }).click()
  const preview = assistant.getByRole('region', { name: 'Learning Plan suggestion' })
  await expect(preview.getByRole('heading', { name: 'Change Preview' })).toBeVisible({ timeout: 20000 })
  await expect(preview.getByText('Before: ' + title)).toBeVisible()
  await expect(preview.getByText('After: Updated fixture learning plan')).toBeVisible()
  const detail = preview.locator('summary')
  await detail.focus()
  await detail.press('Enter')
  await expect(preview.getByText('Compare representations', { exact: false })).toBeVisible()
  await preview.screenshot({ path: testInfo.outputPath('change-preview-mobile.png') })
  const reject = preview.getByRole('button', { name: 'Reject', exact: true })
  await reject.focus()
  await reject.press('Enter')
  await expect(preview.getByText('Suggestion rejected.')).toBeVisible()
  const saved = await (await page.request.get(base + '/learning-plans/' + identifier)).json()
  expect(saved.blueprint.title).toBe(title)
  expect(saved.state_revision).toBe(1)
})

test('redirects the local web alias and keeps the configured origin on API writes', async ({ page, request, baseURL }) => {
  const configured = new URL('/sign-in?source=local#form', baseURL)
  const alias = new URL(configured)
  alias.hostname = 'localhost'
  await page.goto(alias.href)
  await expect(page).toHaveURL(configured.href)
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()

  const rejected = await request.post('/v1/auth/refresh', {
    headers: { Origin: alias.origin },
    maxRedirects: 0,
  })
  expect(rejected.status()).toBe(403)
  expect(await rejected.json()).toMatchObject({ code: 'invalid_origin' })
  const accepted = await request.post('/v1/auth/refresh', {
    headers: { Origin: configured.origin },
    maxRedirects: 0,
  })
  expect(accepted.status()).toBe(401)
})

test('renews access for browser actions and coordinates a shared session across tabs', async ({ page, context }) => {
  await signUp(page, `renewal-${Date.now()}@example.com`)
  await context.clearCookies({ name: 'rag_access' })
  await page.getByRole('textbox', { name: 'Workspace name' }).fill('Renewed workspace')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Renewed workspace' })).toBeVisible()

  const other = await context.newPage()
  let rotations = 0
  context.on('response', response => {
    if (new URL(response.url()).pathname === '/v1/auth/refresh' && response.status() === 204) rotations += 1
  })
  await context.clearCookies({ name: 'rag_access' })
  await Promise.all([page.goto('/workspaces'), other.goto('/account')])
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
  await expect(other.getByRole('heading', { name: 'Account', exact: true })).toBeVisible()
  expect(rotations).toBe(1)

  await context.clearCookies()
  await page.goto('/workspaces')
  await expect(page).toHaveURL(/\/sign-in$/, { timeout: 20000 })
})

test('registration validates each password requirement', async ({ page }) => {
  await page.goto('/register')
  const field = page.getByLabel('Password', { exact: true })
  for (const invalid of ['Phase1!', 'phase1!a', 'Phase!!a', 'Phase11a', 'Phase1 a']) {
    await field.fill(invalid)
    expect(await field.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false)
  }
  await field.fill(password)
  expect(await field.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true)
})

async function signUp(page: Page, email: string) {
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page).toHaveURL(/\/sign-in\?registered=1$/, { timeout: 20000 })
  await signIn(page, email)
}

async function signIn(page: Page, email: string) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  const response = page.waitForResponse(result => result.request().method() === 'POST' &&
    new URL(result.url()).pathname === '/v1/auth/login')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const loggedIn = await response
  expect(loggedIn.status(), await loggedIn.text()).toBe(200)
  await expect(page).toHaveURL(/\/workspaces$/, { timeout: 20000 })
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible({ timeout: 15000 })
}

async function userId(page: Page) {
  await page.getByRole('link', { name: 'Account', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'User ID' })
  await expect(input).toBeVisible()
  return input.inputValue()
}

async function grant(page: Page, id: string, role: 'VIEWER' | 'EDITOR') {
  await page.getByRole('textbox', { name: 'User ID' }).fill(id)
  await page.getByRole('combobox', { name: 'Access', exact: true }).selectOption(role)
  await page.getByRole('button', { name: 'Grant access' }).click()
  await expect(page.getByText(id, { exact: true })).toBeVisible()
}

test('owner shares a workspace with a viewer and editor, then revokes and deletes', async ({ browser, page, baseURL }) => {
  test.slow()
  const viewerContext = await browser.newContext({ baseURL })
  const editorContext = await browser.newContext({ baseURL })
  const suffix = Date.now()
  try {
    await page.goto('/workspaces')
    await expect(page).toHaveURL(/\/sign-in$/, { timeout: 20000 })
    const viewer = await viewerContext.newPage()
    const editor = await editorContext.newPage()
    await signUp(page, `owner-browser-${suffix}@example.com`)
    await signUp(viewer, `viewer-browser-${suffix}@example.com`)
    await signUp(editor, `editor-browser-${suffix}@example.com`)
    const viewerId = await userId(viewer)
    const editorId = await userId(editor)

    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('function')
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('Study group')
    await page.getByRole('button', { name: 'Create workspace' }).click()
    try {
      await expect(page.getByRole('heading', { name: 'Study group' })).toBeVisible()
    } catch (error) {
      throw new Error(`Workspace creation failed: ${await page.getByRole('alert').allTextContents()}`, { cause: error })
    }
    await page.getByRole('button', { name: 'Sharing', exact: true }).click()
    await grant(page, viewerId, 'VIEWER')
    await grant(page, editorId, 'EDITOR')

    await viewer.getByRole('link', { name: 'Back to workspaces' }).click()
    const viewed = viewer.getByRole('article', { name: 'Study group' })
    await expect(viewed).toBeVisible()
    await expect(viewed.getByRole('button', { name: 'Rename' })).toHaveCount(0)
    await editor.getByRole('link', { name: 'Back to workspaces' }).click()
    await editor.getByRole('button', { name: 'Rename', exact: true }).click()
    await editor.getByRole('textbox', { name: 'New name' }).fill('Research group')
    await editor.getByRole('button', { name: 'Save name' }).click()
    await expect(editor.getByRole('heading', { name: 'Research group' })).toBeVisible()
    await expect(editor.getByRole('button', { name: 'Sharing', exact: true })).toHaveCount(0)

    await page.getByRole('listitem').filter({ hasText: viewerId }).getByRole('button', { name: 'Revoke access' }).click()
    await expect(page.getByText(viewerId, { exact: true })).toHaveCount(0)
    await viewer.reload()
    await expect(viewer.getByText('You have no workspaces yet.')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Research group' })).toBeVisible()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('You have no workspaces yet.')).toBeVisible()

    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(/\/sign-in$/, { timeout: 20000 })
    await page.goto('/workspaces')
    await expect(page).toHaveURL(/\/sign-in$/, { timeout: 20000 })
  } finally {
    await Promise.allSettled([viewerContext.close(), editorContext.close()])
  }
})

test('administrator can read the overview and filter user accounts', async ({ page }) => {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill('phase01-admin@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Phase1!a')
  const login = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/v1/auth/login')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  expect((await login).status()).toBe(200)
  await expect(page).toHaveURL(/\/workspaces$/, { timeout: 20000 })
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible({ timeout: 20000 })
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Service health' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Admin console navigation' })
    .getByRole('button', { name: 'Users', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search by email' }).fill('phase01-admin@example.com')
  const user = page.getByRole('row', { name: /phase01-admin@example\.com/ })
  await expect(user.getByRole('cell', { name: 'Current account' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'System configuration' })).toBeVisible()
})
