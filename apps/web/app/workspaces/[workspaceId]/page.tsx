import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AccountMenu } from '../../components/account-menu'
import { ApiError, type Workspace } from '../../lib/api'
import { signedInRequest } from '../../lib/gateway'
import { documentPage, identifier, workspaceLocation } from '../../lib/workspace-location'
import { DocumentShelf, type DocumentItem } from './document-shelf'

type Context = {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ document?: string | string[]; page?: string | string[] }>
}

export default async function WorkspaceDocuments({ params, searchParams }: Context) {
  const [{ workspaceId }, { document, page }] = await Promise.all([params, searchParams])
  if (!identifier.test(workspaceId)) notFound()
  const selected = typeof document === 'string' && identifier.test(document) ? document : undefined
  const initialPage = documentPage(typeof page === 'string' ? page : null)
  const returnTo = workspaceLocation(workspaceId, selected, initialPage)
  const path = '/v1/workspaces/' + workspaceId
  try {
    const workspace = await signedInRequest<Workspace>(path, returnTo)
    const items = await signedInRequest<DocumentItem[]>(path + '/documents', returnTo)
    return (
      <>
        <AccountMenu />
        <main className="document-page">
          <Link href="/workspaces" prefetch={false}>Back to workspaces</Link>
          <h1>{workspace.name}</h1>
          <DocumentShelf workspace={workspace} items={items} selected={selected} initialPage={initialPage} />
        </main>
      </>
    )
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }
}
