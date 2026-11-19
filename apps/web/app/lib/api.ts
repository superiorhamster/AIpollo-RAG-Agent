export type Account = {
  user_id: string
  email: string
  role: 'USER' | 'ADMIN'
}

export type Workspace = {
  workspace_id: string
  name: string
  role: 'OWNER' | 'EDITOR' | 'VIEWER'
}

export type Member = { user_id: string; role: 'EDITOR' | 'VIEWER' }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export class RenewalUnconfirmed extends ApiError {
  constructor() {
    super(401, 'Could not confirm session renewal. Sign in again.')
  }
}

export async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new ApiError(response.status, body?.message ?? 'The service is temporarily unavailable.')
  }
  if (response.status === 204 || (response.status === 202 && !response.headers.has('content-type'))) {
    return undefined as T
  }
  return await response.json() as T
}

export async function api<T>(path: string, method = 'GET', data?: object, key?: string): Promise<T> {
  const headers = new Headers()
  if (data) headers.set('Content-Type', 'application/json')
  if (key) headers.set('Idempotency-Key', key)
  return readResponse<T>(await authenticatedFetch(path, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  }))
}

export async function authenticatedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const send = () => fetch(path, {
    ...options,
    cache: 'no-store',
  })
  const response = await send()
  if (response.status === 401 && (
    path === '/v1/auth/me' || path === '/v1/auth/admin-access' ||
    path.startsWith('/v1/admin/') || path === '/v1/workspaces' || path.startsWith('/v1/workspaces/')
  )) {
    await renewSession()
    return send()
  }
  return response
}

let renewal: Promise<void> | undefined

export function renewSession(): Promise<void> {
  if (renewal) return renewal
  async function refresh() {
    const current = await fetch('/v1/auth/me', { cache: 'no-store' })
    if (current.status !== 401) {
      await readResponse(current)
      return
    }
    try {
      const response = await fetch('/v1/auth/refresh', { method: 'POST', cache: 'no-store',
        signal: AbortSignal.timeout(8000) })
      await readResponse(response)
      await readResponse(await fetch('/v1/auth/me', {
        cache: 'no-store', signal: AbortSignal.timeout(8000),
      }))
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error
      throw new RenewalUnconfirmed()
    }
  }
  async function coordinatedRefresh() {
    if (navigator.locks) {
      await navigator.locks.request('rag-session-renewal', refresh)
    } else {
      await refresh()
    }
  }
  const pending = coordinatedRefresh().finally(() => { renewal = undefined })
  renewal = pending
  return pending
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The service is temporarily unavailable. Try again.'
}
