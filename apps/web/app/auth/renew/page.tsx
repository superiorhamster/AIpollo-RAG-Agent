import { safeReturnTo } from '../../lib/workspace-location'
import { RenewSession } from './renew-session'

export default async function RenewalPage({ searchParams }: {
  searchParams: Promise<{ returnTo?: string | string[] }>
}) {
  const { returnTo } = await searchParams
  return <RenewSession returnTo={safeReturnTo(returnTo)} />
}
