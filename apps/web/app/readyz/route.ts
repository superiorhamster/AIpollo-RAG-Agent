import { gatewayUrl } from '../lib/gateway'

export async function GET() {
  let ready = false
  try {
    const upstream = await fetch(gatewayUrl() + '/readyz', {
      cache: 'no-store',
      signal: AbortSignal.timeout(2200),
    })
    ready = upstream.ok
  } catch {
    ready = false
  }
  return Response.json({ service: 'web', status: ready ? 'ready' : 'unavailable' }, { status: ready ? 200 : 503 })
}
