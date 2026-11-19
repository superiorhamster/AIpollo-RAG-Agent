import { AccountMenu } from '../components/account-menu'
import type { Workspace } from '../lib/api'
import { signedInRequest } from '../lib/gateway'
import { WorkspaceList } from './workspace-list'

export default async function WorkspacesPage() {
  const workspaces = await signedInRequest<Workspace[]>('/v1/workspaces', '/workspaces')
  return (
    <>
      <AccountMenu />
      <main>
        <h1>Workspaces</h1>
        <WorkspaceList initial={workspaces} />
      </main>
    </>
  )
}
