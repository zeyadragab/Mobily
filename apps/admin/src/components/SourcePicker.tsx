import { useAuth } from '../auth/AuthProvider'
import { useAccounts } from '../lib/accounts'
import { useDrawerBalances } from '../lib/drawers'
import { formatEGP, toMinor } from '../lib/money'
import { Field, inputCls } from './ui'

/** Compact account select for a payment line (card / wallet / transfer). Empty = record only. */
export function AccountSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const accounts = useAccounts()
  const list = (accounts.data ?? []).filter((a) => a.is_active)
  if (list.length === 0) return null
  return (
    <select aria-label="الحساب" className={`${inputCls} !w-48`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">بدون حساب (تسجيل فقط)</option>
      {list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  )
}

/**
 * Where the money comes from / goes to: a drawer for cash, a wallet or machine account for anything else.
 * Empty value = the default (products drawer for cash; no account movement for non-cash).
 */
export default function SourcePicker({
  method, drawer, account, onDrawer, onAccount, className = '',
}: {
  method: string
  drawer: string
  account: string
  onDrawer: (code: string) => void
  onAccount: (id: string) => void
  className?: string
}) {
  const { hasRole } = useAuth()
  const boss = hasRole('owner', 'manager')
  const drawers = useDrawerBalances()
  const accounts = useAccounts(method !== 'cash')
  if (method === 'cash') {
    return (
      <Field label="الدرج" className={className}>
        <select className={inputCls} value={drawer} onChange={(e) => onDrawer(e.target.value)}>
          <option value="">درج المنتجات (الافتراضي)</option>
          {(drawers.data ?? []).filter((d) => d.code !== 'products' && (d.code !== 'safe' || boss)).map((d) => (
            <option key={d.id} value={d.code}>{d.name} · {formatEGP(toMinor(d.balance))}</option>
          ))}
        </select>
      </Field>
    )
  }
  const list = (accounts.data ?? []).filter((a) => a.is_active)
  return (
    <Field label="الحساب" className={className} hint={list.length === 0 ? 'أضف محفظة أو ماكينة من صفحة الأرصدة لتتبّع رصيدها' : undefined}>
      <select className={inputCls} value={account} onChange={(e) => onAccount(e.target.value)} disabled={list.length === 0}>
        <option value="">بدون حساب (تسجيل فقط)</option>
        {list.map((a) => <option key={a.id} value={a.id}>{a.name} · {formatEGP(toMinor(a.balance))}</option>)}
      </select>
    </Field>
  )
}
