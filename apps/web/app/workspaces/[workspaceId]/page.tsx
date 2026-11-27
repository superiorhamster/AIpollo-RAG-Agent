import { notFound } from 'next/navigation'
import { ApiError, type Account, type Workspace } from '../../lib/api'
import { signedInRequest } from '../../lib/gateway'
import { documentPage, identifier, parseWorkspaceView, workspaceLocation } from '../../lib/workspace-location'
import { DocumentShelf, type DocumentItem } from './document-shelf'

type Context = {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ document?: string | string[]; page?: string | string[]; view?: string | string[] }>
}

export default async function WorkspaceDocuments({ params, searchParams }: Context) {
  const [{ workspaceId }, { document, page, view }] = await Promise.all([params, searchParams])
  if (!identifier.test(workspaceId)) notFound()
  const selected = typeof document === 'string' && identifier.test(document) ? document : undefined
  const initialPage = documentPage(typeof page === 'string' ? page : null)
  const initialView = parseWorkspaceView(view)
  const returnTo = workspaceLocation(workspaceId, selected, initialPage, initialView)
  const path = '/v1/workspaces/' + workspaceId
  try {
    const [workspace, items, workspaces, account] = await Promise.all([
      signedInRequest<Workspace>(path, returnTo),
      signedInRequest<DocumentItem[]>(path + '/documents', returnTo),
      signedInRequest<Workspace[]>('/v1/workspaces', returnTo),
      signedInRequest<Account>('/v1/auth/me', returnTo),
    ])
    return <DocumentShelf key={returnTo} workspace={workspace} workspaces={workspaces} email={account.email} accountId={account.user_id}
      items={items} selected={selected} initialPage={initialPage} initialView={initialView} />
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }
}
