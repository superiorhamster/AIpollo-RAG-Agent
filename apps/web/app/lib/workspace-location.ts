export const identifier = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function workspaceLocation(workspaceId: string, documentId?: string, page?: number) {
  const path = '/workspaces/' + workspaceId
  if (!documentId) return path
  return path + '?' + new URLSearchParams({ document: documentId, page: String(page ?? 1) })
}

export function documentPage(value: string | null): number {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

export function safeReturnTo(value?: string | string[]) {
  if (value === '/account' || value === '/admin') return value
  if (typeof value !== 'string') return '/workspaces'
  const [path, query] = value.split('?', 2)
  const id = path.slice('/workspaces/'.length)
  if (!path.startsWith('/workspaces/') || !identifier.test(id)) return '/workspaces'
  const params = new URLSearchParams(query)
  const documentId = params.get('document')
  return workspaceLocation(id, documentId && identifier.test(documentId) ? documentId : undefined,
    documentPage(params.get('page')))
}
