import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { expect, test, type APIResponse } from '@playwright/test'

type Citation = { document_id: string; chunk_id: string; name: string; page: number; text: string; region?: number[] }
type Claim = { text: string; citations: Citation[] }
type Cell = { document_id: string; criterion: string; status: string; finding: string; citations: Citation[] }
type Run = { run_id: string; request_id: string; status: string; error_code?: string; result: {
  claims: Claim[]; insufficient_evidence: boolean; evidence_matrix?: Cell[]; verified_draft?: boolean;
  defense_review?: { assessment: string; target_citations: Citation[]; counter_citations: Citation[] }; tutor_question?: string
} }

test('real agentic paper coverage, verified drafting and personal learning', async ({ page, baseURL }) => {
  const indexTimeout = (Number(process.env.LOCAL_RAG_PARSE_SECONDS ?? 300) + 150) * 1000
  const runTimeout = (Number(process.env.LOCAL_RAG_RUN_SECONDS ?? 210) + 30) * 1000
  test.setTimeout(indexTimeout * 2 + runTimeout * 9 + 60000)
  const evaluationDir = '/tests/test-results/evaluation'
  await mkdir(evaluationDir, { recursive: true })
  const origin = baseURL!
  async function withSession(send: () => Promise<APIResponse>) {
    let response = await send()
    if (response.status() === 401) {
      const renewed = await page.request.post('/v1/auth/refresh', { headers: { Origin: origin } })
      expect(renewed.status()).toBe(204)
      response = await send()
    }
    return response
  }
  const authed = {
    get: (...args: Parameters<typeof page.request.get>) => withSession(() => page.request.get(...args)),
    post: (...args: Parameters<typeof page.request.post>) => withSession(() => page.request.post(...args)),
    delete: (...args: Parameters<typeof page.request.delete>) => withSession(() => page.request.delete(...args)),
  }
  const headers = () => ({ Origin: origin, 'Idempotency-Key': randomUUID() })
  const modelRuns: { case: string; mode: string; milliseconds: number; poll_retries: number; run: Run }[] = []
  const factsA = 'Model Alpha uses a transformer encoder with sparse attention. Latency is 3 seconds per batch. Under protocol P with hardware Omega and seed 7, the shared baseline Model Gamma has accuracy 84%. The draft asserts that all encoders must use transformers, without a citation for this universal claim.'
  const factsB = 'Model Beta uses a recurrent encoder. The dataset is Vietnamese benchmark V2, containing 1200 annotated sequences. Latency is 2000 milliseconds per batch. Under protocol P with hardware Omega and seed 7, the shared baseline Model Gamma has accuracy 79%.'
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  async function pdf(title: string, facts: string, dense: boolean) {
    const filler = dense ? Array.from({ length: 6 }, (_, i) => `<h2>Method discussion ${i + 1}</h2><p>${'The Alpha method uses a transformer encoder to study attention representations and compare sequence-processing methods. '.repeat(14)}</p>`).join('') : ''
    await page.setContent(`<meta charset="utf-8"><style>body{font-family:"DejaVu Sans",sans-serif;font-size:16px;line-height:1.5;margin:45px}</style><h1>${title}</h1><p>${escape(facts)}</p>${filler}`)
    return page.pdf({ format: 'A4', printBackground: true })
  }
  const aPdf = await pdf('Synthetic Paper A', factsA, true)
  const bPdf = await pdf('Synthetic Paper B', factsB, false)
  await writeFile(evaluationDir + '/paper-a.pdf', aPdf)
  await writeFile(evaluationDir + '/paper-b.pdf', bPdf)
  const email = `agentic-eval-${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('LiveTest12!')
  await page.getByLabel('Confirm password', { exact: true }).fill('LiveTest12!')
  await page.getByRole('button', { name: 'Create account', exact: true }).click({ noWaitAfter: true })
  await expect(page).toHaveURL(/\/sign-in\?registered=1$/, { timeout: 20000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('LiveTest12!')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/workspaces$/, { timeout: 20000 })
  const created = await authed.post('/v1/workspaces', { headers: headers(), data: { name: 'Synthetic agentic quality evaluation' } })
  expect(created.status()).toBe(201)
  const workspace = (await created.json()).workspace_id
  const base = `/v1/workspaces/${workspace}`
  const documents: string[] = []
  try {
    for (const [filename, data] of [['paper-a.pdf', aPdf], ['paper-b.pdf', bPdf]] as const) {
      const response = await authed.post(base + '/documents', { headers: { ...headers(), 'X-Filename': filename, 'Content-Type': 'application/octet-stream' }, data, timeout: 135000 })
      expect(response.status()).toBe(201)
      const document = (await response.json()).document_id
      documents.push(document)
      await expect.poll(async () => {
        const jobs = await authed.get(base + `/documents/${document}/jobs`, { timeout: 20000 })
        expect(jobs.status()).toBe(200)
        return (await jobs.json() as { kind: string; status: string }[]).find(job => job.kind === 'index')?.status
      }, { timeout: indexTimeout, intervals: [2000] }).toBe('succeeded')
    }
    async function run(mode: 'ASK' | 'AGENT', capability: string, task: string, query: string, scenario: string, extra = {}) {
      const before = Date.now()
      const submitted = await authed.post(base + '/runs', { headers: headers(), data: { mode, objective: { capability, task, query, document_ids: documents, ...extra } } })
      expect(submitted.status()).toBe(202)
      const id = (await submitted.json()).run_id
      let completed: Run | undefined
      let pollRetries = 0
      await expect.poll(async () => {
        const response = await authed.get(base + '/runs/' + id, { timeout: 20000 })
        if (response.status() === 503 && pollRetries < 3) { pollRetries += 1; return false }
        expect(response.status()).toBe(200)
        completed = await response.json()
        return completed && ['succeeded', 'failed', 'cancelled'].includes(completed.status)
      }, { timeout: runTimeout, intervals: [1000] }).toBeTruthy()
      if (!completed) throw new Error('No terminal result')
      await writeFile(evaluationDir + '/research-progress.json', JSON.stringify({ documents,
        model_runs: [...modelRuns, { case: scenario, mode, milliseconds: Date.now() - before, poll_retries: pollRetries, run: completed }] }, null, 2))
      expect(completed.status, JSON.stringify({ error_code: completed.error_code })).toBe('succeeded')
      const citations = [...completed.result.claims.flatMap(claim => claim.citations), ...(completed.result.evidence_matrix?.flatMap(cell => cell.citations) ?? [])]
      expect(citations.every(citation => documents.includes(citation.document_id) && citation.page >= 1)).toBeTruthy()
      modelRuns.push({ case: scenario, mode, milliseconds: Date.now() - before, poll_retries: pollRetries, run: completed })
      return completed
    }
    const query = 'So sánh phương pháp, dataset và độ trễ của Paper A và Paper B. Giữ nguyên đơn vị được báo cáo; đánh dấu dữ liệu còn thiếu.'
    const baseline = await run('ASK', 'RESEARCH', 'comparison', query, 'coverage_units')
    const compared = await run('AGENT', 'RESEARCH', 'comparison', query, 'coverage_units')
    const matrix = compared.result.evidence_matrix ?? []
    expect(matrix.length).toBeGreaterThanOrEqual(4)
    const dataset = matrix.find(cell => cell.document_id === documents[1] && cell.status === 'supported' && /V2/.test(cell.finding))
    expect(dataset).toBeTruthy()
    expect(matrix.find(cell => cell.document_id === documents[0] && cell.criterion === dataset!.criterion)?.status).toBe('insufficient')
    expect(matrix.some(cell => cell.document_id === documents[0] && cell.status === 'supported' && /transformer/i.test(cell.finding))).toBeTruthy()
    expect(matrix.some(cell => cell.document_id === documents[1] && cell.status === 'supported' && /recurrent|RNN|hồi quy|hồi qui|hồi tiếp/i.test(cell.finding))).toBeTruthy()
    expect(matrix.some(cell => cell.document_id === documents[0] && /3/.test(cell.finding))).toBeTruthy()
    expect(matrix.some(cell => cell.document_id === documents[1] && /2000|2\.000|2,000/.test(cell.finding))).toBeTruthy()
    const conflict = await run('AGENT', 'RESEARCH', 'comparison', 'Đối chiếu kết quả accuracy của baseline Model Gamma theo protocol P trong hai paper, giữ cả hai số liệu trái ngược.', 'conflicting_numbers')
    expect(conflict.result.evidence_matrix?.some(cell => cell.document_id === documents[0] && cell.status === 'supported' && /84/.test(cell.finding))).toBeTruthy()
    expect(conflict.result.evidence_matrix?.some(cell => cell.document_id === documents[1] && cell.status === 'supported' && /79/.test(cell.finding))).toBeTruthy()
    const missing = await run('AGENT', 'RESEARCH', 'comparison', 'Mỗi model cần chính xác bao nhiêu GB GPU memory khi deploy? Chỉ dùng các số liệu được báo cáo trong hai paper.', 'unanswerable')
    expect(missing.result.insufficient_evidence).toBeTruthy()
    expect(missing.result.evidence_matrix?.every(cell => cell.status === 'insufficient')).toBeTruthy()
    const draft = await run('AGENT', 'WRITE', 'draft', 'Viết một đoạn tổng quan ngắn về phương pháp Alpha/Beta và dataset V2, có trích dẫn chính xác.', 'verified_draft')
    expect(draft.result.verified_draft).toBeTruthy()
    expect(draft.result.claims.length).toBeGreaterThan(0)
    const defense = await run('ASK', 'RESEARCH', 'mock_defense', 'Phản biện nhận định mọi encoder đều dùng transformer trong bản nháp A, đối chiếu phương pháp hồi quy ở B. Hỏi tôi một câu để bảo vệ giả định.', 'mock_defense', { draft_document_id: documents[0] })
    expect(defense.result.defense_review?.target_citations.every(citation => citation.document_id === documents[0])).toBeTruthy()
    if (defense.result.defense_review?.assessment === 'contradicted') expect(defense.result.defense_review.counter_citations.some(citation => citation.document_id === documents[1])).toBeTruthy()
    expect(defense.result.tutor_question?.length).toBeGreaterThan(1)
    const cards = await run('ASK', 'LEARN', 'flashcards', 'Tạo hai flashcard về phương pháp Alpha và dataset V2.', 'flashcards')
    expect(cards.result.claims.length).toBeGreaterThan(0)
    async function save(completed: Run, name: string) {
      const result = await authed.post(base + '/artifacts', { headers: headers(), data: { run_id: completed.run_id, name } })
      expect(result.status()).toBe(201)
      return (await result.json()).artifact_id as string
    }
    const deck = await save(cards, 'Synthetic FSRS deck')
    const due = await authed.get(base + `/artifacts/${deck}/cards?due_only=true`)
    expect(due.status()).toBe(200)
    const card = (await due.json()).cards[0]
    const key = headers()
    const rating = { rating: 3, expected_version: card.version }
    const reviewed = await authed.post(base + `/artifacts/${deck}/cards/${card.card_id}/reviews`, { headers: key, data: rating })
    expect(reviewed.status()).toBe(200)
    const replay = await authed.post(base + `/artifacts/${deck}/cards/${card.card_id}/reviews`, { headers: key, data: rating })
    expect(await replay.json()).toEqual(await reviewed.json())
    const map = await run('ASK', 'LEARN', 'mind_map', 'Tạo sơ đồ khái niệm liên hệ encoder, transformer, recurrent encoder và các model Alpha/Beta.', 'concept_map')
    const mapId = await save(map, 'Synthetic concept graph')
    const detail = await authed.get(base + '/artifacts/' + mapId)
    expect(detail.status()).toBe(200)
    const graph = (await detail.json()).concept_map
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.edges.length).toBeGreaterThan(0)
    expect(graph.nodes.flatMap((node: { citations: Citation[] }) => node.citations).every((citation: Citation) => documents.includes(citation.document_id))).toBeTruthy()
    const times = modelRuns.filter(item => item.mode === 'AGENT' && item.run.result.evidence_matrix).map(item => item.milliseconds).sort((a, b) => a - b)
    const report = { version: 1, workspace, documents, golden_facts: { [documents[0]]: factsA, [documents[1]]: factsB },
      baseline_cited_papers: new Set(baseline.result.claims.flatMap(claim => claim.citations.map(c => c.document_id))).size,
      verified_matrix_cells: matrix.filter(cell => cell.status === 'supported').length, matrix_cells: matrix.length,
      latency_p50_ms: times[Math.floor(times.length / 2)], latency_p95_ms: times[Math.min(times.length - 1, Math.floor(times.length * .95))], model_runs: modelRuns }
    await writeFile(evaluationDir + '/research-output.json', JSON.stringify(report, null, 2))
    console.log('AGENTIC_LIVE_METRICS', JSON.stringify({ matrix_cells: report.matrix_cells, verified_cells: report.verified_matrix_cells,
      baseline_cited_papers: report.baseline_cited_papers, latency_p50_ms: report.latency_p50_ms, latency_p95_ms: report.latency_p95_ms, model_runs: modelRuns.length }))
  } finally {
    expect((await authed.delete(base, { headers: { Origin: origin } })).status()).toBe(202)
  }
})
