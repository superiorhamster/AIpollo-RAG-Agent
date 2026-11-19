import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ApiError, readResponse } from './api'

export function gatewayUrl(): string {
  return (process.env.API_GATEWAY_URL ?? 'http://127.0.0.1:23001').replace(/\/$/, '')
}

export async function signedInRequest<T>(path: string, returnTo: string): Promise<T> {
  const renew = '/auth/renew?returnTo=' + encodeURIComponent(returnTo)
  const session = (await cookies()).get('rag_access')?.value
  if (!session) redirect(renew)

  try {
    const response = await fetch(gatewayUrl() + path, {
      headers: { Cookie: `rag_access=${session}` },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    return await readResponse<T>(response)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect(renew)
    throw error
  }
}
