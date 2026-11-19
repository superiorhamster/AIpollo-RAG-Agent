import { AccountMenu } from '../components/account-menu'
import type { Workspace } from '../lib/api'
import { signedInRequest } from '../lib/gateway'
import { WorkspaceList } from './workspace-list'

export default async function WorkspacesPage() {
  const workspaces = await signedInRequest<Workspace[]>('/v1/workspaces', '/workspaces')
  return (
    <>
      <AccountMenu search={workspaces.map(workspace => ({
        name: workspace.name, href: '/workspaces/' + workspace.workspace_id, kind: 'Workspace',
      }))} />
      <main>
        <div style={{ marginBottom: '1.5rem' }}>
          <h1>Workspaces</h1>
          <p className="muted">Manage your research workspaces, document collections, and collaborator access.</p>
        </div>
        <WorkspaceList initial={workspaces} />
      </main>
    </>
  )
}
