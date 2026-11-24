import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { sessionRequests, waitForIndex } from './live-session'

function response(status: number, job = 'queued') {
  return { status: () => status, dispose: async () => {},
    json: async () => [{ kind: 'index', status: job, error_code: 'parse_timeout' }] } as unknown as APIResponse
}

test('index polling resets transient errors after a successful read', async () => {
  const sequence = [response(503), response(200), response(503), response(200, 'succeeded')]
  const result = await waitForIndex(async () => sequence.shift()!, 25000)
  expect(result[0].status).toBe('succeeded')
  expect(sequence).toHaveLength(0)
})

test('index polling stops after four consecutive unavailable reads', async () => {
  let calls = 0
  await expect(waitForIndex(async () => { calls += 1; return response(503) }, 25000)).rejects.toThrow('HTTP 503')
  expect(calls).toBe(4)
})

test('terminal failed index reports its error without polling again', async () => {
  let calls = 0
  await expect(waitForIndex(async () => { calls += 1; return response(200, 'failed') }, 25000)).rejects.toThrow('parse_timeout')
  expect(calls).toBe(1)
})

test('renewal replays the same mutation once and retains its idempotency key', async () => {
  const calls: { url: string; options: unknown }[] = []
  let authenticated = false
  const request = { post: async (url: string, options: unknown) => {
    calls.push({ url, options })
    if (url.endsWith('/refresh')) { authenticated = true; return response(204) }
    return response(authenticated ? 202 : 401)
  } } as unknown as APIRequestContext
  const options = { headers: { Origin: 'http://localhost:3000', 'Idempotency-Key': 'synthetic-key' }, data: { objective: 'synthetic' } }
  const result = await sessionRequests(request, 'http://localhost:3000').post('/v1/runs', options)
  expect(result.status()).toBe(202)
  expect(calls.map(call => call.url)).toEqual(['/v1/runs', '/v1/auth/refresh', '/v1/runs'])
  expect(calls[2].options).toBe(options)
  expect(calls[1].options).toEqual({ headers: { Origin: 'http://localhost:3000' } })
})
