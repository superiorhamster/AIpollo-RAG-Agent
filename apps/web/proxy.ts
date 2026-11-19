import { NextResponse, type NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const configured = URL.parse(process.env.WEB_ORIGIN ?? '')
  if (request.method !== 'GET' || configured?.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(configured.hostname)) {
    return NextResponse.next()
  }

  const alias = new URL(configured.origin)
  alias.hostname = configured.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
  if (request.headers.get('host')?.toLowerCase() !== alias.host) {
    return NextResponse.next()
  }

  const destination = new URL(configured.origin)
  destination.pathname = request.nextUrl.pathname
  destination.search = request.nextUrl.search
  const response = NextResponse.redirect(destination)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export const config = {
  matcher: ['/', '/sign-in', '/register', '/reset-password', '/account', '/admin', '/auth/renew', '/workspaces/:path*'],
}
