export const identifier = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export type WorkspaceView = 'chats' | 'library' | 'notes' | 'plans' | 'artifacts' | 'references' | 'history'

const validViews = new Set<WorkspaceView>(['chats', 'library', 'notes', 'plans', 'artifacts', 'references', 'history'])

export function parseWorkspaceView(value?: string | string[] | null): WorkspaceView | undefined {
  if (typeof value !== 'string') return undefined
  return validViews.has(value as WorkspaceView) ? (value as WorkspaceView) : undefined
}

export function workspaceLocation(workspaceId: string, documentId?: string, page?: number, view?: WorkspaceView) {
  const path = '/workspaces/' + workspaceId
  const params = new URLSearchParams()
  if (documentId) {
    params.set('document', documentId)
    params.set('page', String(page ?? 1))
  }
  if (view) {
    params.set('view', view)
  }
  const query = params.toString()
  return query ? path + '?' + query : path
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
  return workspaceLocation(
    id,
    documentId && identifier.test(documentId) ? documentId : undefined,
    documentPage(params.get('page')),
    parseWorkspaceView(params.get('view')),
  )
}
