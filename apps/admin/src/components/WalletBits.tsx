import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { matchCustomer, type Customer } from '../lib/customers'
import { formatEGP } from '../lib/money'
import { RANGE_PRESET, type RangePreset } from '../lib/walletOps'
import { Button, Card, ErrorText, Field, inputCls, Modal } from './ui'

/** Shared small parts of the wallet send/receive and bills screens. */

export function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' | 'warn' }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : ''
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </Card>
  )
}

export function NoShiftHint() {
  return (
    <Card className="mb-4 animate-rise border-warn/40 bg-warn/10 p-4 text-sm">
      <p className="font-semibold text-warn">لا توجد وردية مفتوحة</p>
      <p className="mt-1 text-muted">لا يمكن تسجيل أي عملية قبل فتح الوردية. <Link to="/cash" className="font-medium text-fg underline">افتح الوردية من صفحة «الدرج»</Link> ثم ارجع هنا.</p>
    </Card>
  )
}

/** Searchable picker over registered, active customers. */
export function CustomerPicker({
  customers, loading, value, onChange, required,
}: {
  customers: Customer[]
  loading?: boolean
  value: string | null
  onChange: (id: string | null) => void
  required?: boolean
}) {
  const [find, setFind] = useState('')
  const chosen = customers.find((c) => c.id === value) ?? null
  const results = find.trim() ? customers.filter((c) => c.is_active && matchCustomer(c, find)).slice(0, 6) : []
  const label = `العميل ${required ? '(إلزامي)' : '(اختياري)'}`
  if (chosen) {
    return (
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted">{label}</span>
        <div className="flex items-center justify-between gap-2 rounded-[10px] border border-line bg-bg/60 px-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium" dir="auto">{chosen.name}</span>
            <span className="text-xs text-muted"><bdi>{chosen.phone}</bdi> · عليه الآن {formatEGP(chosen.balance)}</span>
          </span>
          <Button small onClick={() => onChange(null)}>تغيير</Button>
        </div>
      </div>
    )
  }
  return (
    <div className="relative">
      <Field label={label} hint={loading ? 'جارٍ تحميل العملاء…' : 'العميل الجديد يُضاف من صفحة «العملاء».'}>
        <input className={inputCls} dir="auto" placeholder="ابحث بالاسم أو رقم الهاتف أو الكود" value={find} onChange={(e) => setFind(e.target.value)} />
      </Field>
      {find.trim() && (
        <ul className="absolute inset-x-0 top-[4.2rem] z-10 max-h-60 animate-fade overflow-y-auto rounded-xl border border-line bg-surface shadow-float">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-bg"
                onClick={() => { onChange(c.id); setFind('') }}>
                <span className="truncate" dir="auto">{c.name}</span><bdi className="text-xs text-muted">{c.phone}</bdi>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">لا يوجد عميل بهذا الاسم أو الرقم.</li>}
        </ul>
      )}
    </div>
  )
}

export function RangeFilter({
  preset, from, to, onPreset, onFrom, onTo,
}: {
  preset: RangePreset
  from: string
  to: string
  onPreset: (p: RangePreset) => void
  onFrom: (v: string) => void
  onTo: (v: string) => void
}) {
  return (
    <>
      <select aria-label="الفترة" className={`${inputCls} !w-36`} value={preset} onChange={(e) => onPreset(e.target.value as RangePreset)}>
        {Object.entries(RANGE_PRESET).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {preset === 'custom' && <>
        <input aria-label="من تاريخ" type="date" className={`${inputCls} !w-40`} value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} />
        <input aria-label="إلى تاريخ" type="date" className={`${inputCls} !w-40`} value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} />
      </>}
    </>
  )
}

/** Cancel with a required reason. `run` does the call and throws on failure. */
export function CancelDialog({
  title, text, run, onClose, onDone,
}: {
  title: string
  text: string
  run: (reason: string) => Promise<void>
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const save = useMutation({ mutationFn: () => run(reason.trim()), onSuccess: onDone })
  return (
    <Modal open onClose={onClose} title={title}
      footer={<><Button onClick={onClose}>رجوع</Button><Button variant="danger" disabled={save.isPending || reason.trim().length < 3} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}</Button></>}>
      <div className="space-y-3 text-sm">
        <ErrorText error={save.error} />
        <p className="text-muted">{text}</p>
        <Field label="سبب الإلغاء (إلزامي)"><input className={inputCls} dir="auto" autoFocus maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
