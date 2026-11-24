import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'

export function sessionRequests(request: APIRequestContext, origin: string) {
  async function withSession(send: () => Promise<APIResponse>) {
    const first = await send()
    if (first.status() !== 401) return first
    await first.dispose()
    const renewal = await request.post('/v1/auth/refresh', { headers: { Origin: origin } })
    expect(renewal.status(), 'session renewal').toBe(204)
    return send()
  }
  return {
    get: (...args: Parameters<typeof request.get>) => withSession(() => request.get(...args)),
    post: (...args: Parameters<typeof request.post>) => withSession(() => request.post(...args)),
    delete: (...args: Parameters<typeof request.delete>) => withSession(() => request.delete(...args)),
  }
}

type IndexJob = { kind: string; status: string; error_code?: string }

export async function waitForIndex(read: () => Promise<APIResponse>, timeout: number) {
  let consecutiveFailures = 0
  const started = Date.now()
  let polls = 0
  let unavailable = 0
  let jobs: IndexJob[] = []
  let failure: string | undefined
  await expect.poll(async () => {
    const response = await read()
    polls += 1
    if (response.status() === 503) {
      unavailable += 1
      consecutiveFailures += 1
      if (consecutiveFailures <= 3) return false
    }
    if (response.status() !== 200) {
      failure = `Reading document jobs returned HTTP ${response.status()}`
      return true
    }
    consecutiveFailures = 0
    jobs = await response.json()
    const index = jobs.find(job => job.kind === 'index')
    if (index && ['failed', 'cancelled'].includes(index.status)) {
      failure = `Index ${index.status}: ${index.error_code ?? 'no error code'}`
      return true
    }
    return index?.status === 'succeeded'
  }, { timeout, intervals: [2000, 4000], message: 'waiting for index publication' }).toBe(true)
  if (failure) throw new Error(failure)
  console.log('INDEX_POLL', { polls, unavailable, elapsed_ms: Date.now() - started })
  return jobs
}
