import Link from 'next/link'
import { AccountForm } from '../components/account-form'

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ renewal?: string | string[] }>
}) {
  const { renewal } = await searchParams
  return <AccountForm register={false} renewalUnconfirmed={renewal === 'unconfirmed'} />
}
