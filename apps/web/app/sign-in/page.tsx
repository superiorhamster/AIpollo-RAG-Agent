import { AccountForm } from '../components/account-form'

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ renewal?: string | string[]; registered?: string }>
}) {
  const { renewal, registered } = await searchParams
  return <AccountForm register={false} registered={registered === '1'} renewalUnconfirmed={renewal === 'unconfirmed'} />
}
