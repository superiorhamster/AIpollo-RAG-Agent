import { gatewayUrl } from '../../lib/gateway'

type Context = { params: Promise<{ path: string[] }> }

async function relay(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params
  if (!path.every(segment => /^[a-zA-Z0-9-]+$/.test(segment))) {
    return new Response(null, { status: 404 })
  }
  const headers = new Headers()
  for (const name of ['content-type', 'cookie', 'origin', 'x-request-id', 'idempotency-key', 'x-filename', 'range', 'content-length']) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  const upload = request.method === 'POST' && path.length === 3 && path[2] === 'documents'
  const search = path.length === 3 && path[0] === 'workspaces' && path[2] === 'search'
  const file = path[2] === 'documents' && ['preview', 'original'].includes(path[4])
  const remote = path[0] === 'admin' || path[1] === 'password-reset'
  const discovery = path[2] === 'references' && path[3] === 'discover'
  const events = path.length === 5 && path[2] === "runs" && path[4] === "events"
  const options: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(upload ? 130000 : file ? 120000 : (search || events) ? 65000 : (discovery || remote) ? 18000 : 8000),
  }
  if (request.body !== null) {
    options.body = request.body
    options.duplex = 'half'
  }

  try {
    const upstream = await fetch(gatewayUrl() + '/v1/' + path.join('/'), options)
    const resultHeaders = new Headers({ 'Cache-Control': 'no-store' })
    for (const name of ['content-type', 'x-request-id', 'retry-after', 'allow', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'cache-control', 'x-accel-buffering']) {
      const value = upstream.headers.get(name)
      if (value !== null) resultHeaders.set(name, value)
    }
    for (const cookie of upstream.headers.getSetCookie()) resultHeaders.append('Set-Cookie', cookie)
    return new Response(upstream.body, { status: upstream.status, headers: resultHeaders })
  } catch {
    const request_id = crypto.randomUUID()
    return Response.json({ code: 'unavailable', message: 'The API is temporarily unavailable.', request_id }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': request_id },
    })
  }
}

export { relay as DELETE, relay as GET, relay as HEAD, relay as PATCH, relay as POST, relay as PUT }
