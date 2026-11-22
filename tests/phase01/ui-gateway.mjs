// Loopback-only UI fixtures. No credentials, real provider calls or application data.
import { createServer } from 'node:http'
const workspace = '33333333-3333-4333-8333-333333333333'
const document = '44444444-4444-4444-8444-444444444444'
const artifact = '55555555-5555-4555-8555-555555555555'
const run = '66666666-6666-4666-8666-666666666666'
const account = { user_id: '11111111-1111-4111-8111-111111111111', email: 'ui-fixture@example.com', role: 'USER' }
const space = { workspace_id: workspace, name: 'UI fixture workspace', role: 'OWNER' }
const citation = { document_id: document, chunk_id: '77777777-7777-4777-8777-777777777777',
  name: 'ready.pdf', page: 2, text: 'The demo is in B4-201.', section: '', region: [.1, .1, .8, .2] }
const claims = [{ text: 'The demo is in B4-201.', fields: {}, source: 'document', citations: [citation] }]
const artifactDetail = { artifact_id: artifact, name: 'Saved fixture', kind: 'study_guide', can_manage: true, body: { claims } }
const runView = { run_id: run, interaction: 'ASK', status: 'succeeded', step: 'compose', query: 'Where is the demo?',
  conversation_id: '88888888-8888-4888-8888-888888888888', plan_id: null, plan_version: null, error_code: null,
  created_at: '2026-11-21T00:00:00Z', updated_at: '2026-11-21T00:00:00Z', result: { kind: 'answer', claims, insufficient_evidence: false } }
let researchDocuments = false
let pdf = Buffer.alloc(0)
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  const pieces = []
  for await (const part of request) pieces.push(part)
  const bytes = Buffer.concat(pieces)
  const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
  if (path === '/__fixture/research' && request.method === 'POST') { researchDocuments = JSON.parse(bytes).enabled === true; return json({ ok: true }) }
  if (path === '/__fixture/pdf' && request.method === 'POST') { pdf = bytes; return json({ ok: true }) }
  if (path.endsWith('/preview')) {
    response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length })
    return response.end(request.method === 'HEAD' ? undefined : pdf)
  }
  if (path.endsWith('/events')) { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); return response.end('data: ' + JSON.stringify(runView) + '\n\n') }
  if (path.endsWith('/workflow-features')) return json({ custom_plan: true, socratic_tutor: true, curriculum: true, research: true, discovery: true, mock_defense: true })
  if (path.endsWith('/auth/me')) return json(account)
  if (path.endsWith('/auth/register')) return json(account, 201)
  if (path.endsWith('/auth/login')) return json(account)
  if (path.endsWith('/jobs')) return json([{ job_id: '99999999-9999-4999-8999-999999999999', kind: 'index', status: 'succeeded', attempts: 1, error_code: null }])
  if (path.endsWith('/documents')) {
    const item = { document_id: document, workspace_id: workspace, name: 'ready.pdf', filename: 'ready.pdf', media_type: 'application/pdf', size_bytes: pdf.length, preview_ready: true, created_at: '2026-11-21T00:00:00Z' }
    return json([item, ...(researchDocuments ? [{ ...item, document_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Paper B.pdf', filename: 'Paper B.pdf' }] : [])])
  }
  if (path.endsWith('/conversations') || path.endsWith('/annotations') || path.endsWith('/references')) return json([])
  if (path.endsWith('/artifacts')) return request.method === 'POST' ? json(artifactDetail, 201) : json([artifactDetail])
  if (path.endsWith('/artifacts/' + artifact)) return json(artifactDetail)
  if (path.endsWith('/runs')) return json(runView, 202)
  if (path.endsWith('/runs/' + run)) return json(runView)
  if (path.endsWith('/workspaces')) return json([space])
  if (path.endsWith('/workspaces/' + workspace)) return json(space)
  if (path.endsWith('/healthz') || path.endsWith('/readyz')) return json({ status: 'ready' })
  return json({ code: 'not_found', message: 'Unknown fixture route.' }, 404)
}).listen(24001, process.env.UI_FIXTURE_HOST ?? '127.0.0.1')
