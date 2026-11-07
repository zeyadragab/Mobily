import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatEGP, toMinor } from '../lib/money'
import { cairoBusinessDate, formatCairo } from '../lib/time'
import { Button, Card, Chip, inputCls, PageHeader } from '../components/ui'
import { State } from '../components/State'

type Row = {
  kind: string
  ref_id: string
  ref: string
  amount: string
  at: string
  actor: string | null
  status: string
  detail: string
}

export const KIND_AR: Record<string, string> = {
  sale: 'بيع',
  return: 'مرتجع',
  supplier_invoice: 'فاتورة مورد',
  supplier_payment: 'دفعة مورد',
  expense: 'مصروف مسجل',
  expense_payment: 'دفع مصروف',
  purchase_order: 'أمر شراء',
  stock_adjustment: 'تسوية مخزون',
  cash_session: 'الدرج',
  online_order: 'طلب من الموقع',
  approval: 'طلب موافقة',
}
const STATUS_AR: Record<string, string> = {
  completed: 'مكتمل', pending_approval: 'بانتظار موافقة', void: 'ملغي', open: 'مفتوح', rejected: 'مرفوض',
  paid: 'مدفوع', done: 'تم', closed: 'مغلق', submitted: 'بانتظار القرار', approved: 'تمت الموافقة',
  executed: 'تم التنفيذ', changes_requested: 'مطلوب تعديل', superseded: 'استُبدل', expired: 'منتهي',
  reserved: 'محجوز', confirmed: 'مؤكد', ready: 'جاهز', delivered: 'تم التسليم', cancelled: 'ملغي',
  sent: 'أُرسلت', partially_received: 'استلام جزئي', received: 'تم الاستلام',
}
const tone = (s: string) =>
  ['completed', 'paid', 'done', 'approved', 'executed', 'delivered', 'received'].includes(s) ? 'ok'
  : ['pending_approval', 'submitted', 'open', 'reserved', 'partially_received'].includes(s) ? 'warn'
  : ['void', 'rejected', 'cancelled', 'expired'].includes(s) ? 'danger' : 'neutral'

function amountText(r: Row) {
  const n = Number(r.amount)
  if (r.kind === 'stock_adjustment') return `${n > 0 ? '+' : ''}${n} وحدة`
  if (r.kind === 'cash_session') return n === 0 ? '—' : `فرق ${formatEGP(toMinor(r.amount))}`
  return formatEGP(toMinor(r.amount))
}

export default function Transactions() {
  const [params, setParams] = useSearchParams()
  const [kind, setKind] = useState(params.get('kind') ?? '')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')

  const q = useQuery({
    queryKey: ['transactions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('transactions_feed').select('*').order('at', { ascending: false }).limit(1000)
      if (error) throw error
      return data as Row[]
    },
  })
  const names = useQuery({
    queryKey: ['profile-names'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id,full_name')
      return new Map(((data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]))
    },
  })

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter((r) => {
      const d = cairoBusinessDate(new Date(r.at))
      return (!kind || r.kind === kind) && (!from || d >= from) && (!to || d <= to) &&
        (!s || r.ref.toLowerCase().includes(s) || r.detail.toLowerCase().includes(s))
    })
  }, [q.data, kind, from, to, search])

  const who = (id: string | null) => (id ? names.data?.get(id) || id.slice(0, 6) : 'الموقع / النظام')

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = rows.map((r) => [formatCairo(r.at), KIND_AR[r.kind] ?? r.kind, r.ref, r.detail, r.amount, STATUS_AR[r.status] ?? r.status, who(r.actor)].map(esc).join(','))
    const blob = new Blob(['﻿' + ['الوقت,النوع,المرجع,التفاصيل,المبلغ,الحالة,المنفذ', ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'transactions.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div>
      <PageHeader title="كل المعاملات" subtitle="كل ما سجّله المدير والموظفون في مكان واحد: مبيعات، مصروفات، مشتريات، مخزون، درج وموافقات."
        actions={<Button disabled={rows.length === 0} onClick={exportCsv}>تصدير CSV</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <select className={`${inputCls} sm:w-48`} aria-label="النوع" value={kind} onChange={(e) => { setKind(e.target.value); setParams(e.target.value ? { kind: e.target.value } : {}) }}>
          <option value="">كل الأنواع</option>
          {Object.entries(KIND_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="date" className={`${inputCls} sm:w-40`} dir="ltr" aria-label="من" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className={`${inputCls} sm:w-40`} dir="ltr" aria-label="إلى" value={to} onChange={(e) => setTo(e.target.value)} />
        <input className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`} placeholder="بحث بالمرجع أو التفاصيل" aria-label="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {q.isLoading && <State kind="loading" />}
      {q.isError && <State kind="error" text="تعذّر تحميل المعاملات." />}
      {q.data && rows.length === 0 && <State kind="empty" title="لا توجد معاملات مطابقة" />}
      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted"><tr className="border-b border-line">
              {['الوقت', 'النوع', 'المرجع', 'التفاصيل', 'المبلغ', 'الحالة', 'المنفذ'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.kind + r.ref_id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap p-3">{formatCairo(r.at)}</td>
                  <td className="p-3">{KIND_AR[r.kind] ?? r.kind}</td>
                  <td className="p-3 font-medium" dir="auto">{r.ref}</td>
                  <td className="max-w-64 truncate p-3 text-muted" dir="auto" title={r.detail}>{r.detail || '—'}</td>
                  <td className="whitespace-nowrap p-3 font-semibold">{amountText(r)}</td>
                  <td className="p-3"><Chip tone={tone(r.status)}>{STATUS_AR[r.status] ?? r.status}</Chip></td>
                  <td className="p-3" dir="auto">{who(r.actor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {q.data && q.data.length >= 1000 && <p className="mt-2 text-xs text-muted">يعرض آخر 1000 معاملة. استخدم الفلاتر أو التصدير لفترات أقصر.</p>}
    </div>
  )
}
