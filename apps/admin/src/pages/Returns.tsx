import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { METHOD_AR } from '../lib/data'
import { formatEGP, toMinor } from '../lib/money'
import { cairoBusinessDate, formatCairo } from '../lib/time'
import { downloadCsv } from '../lib/repairs'
import { Button, Card, Chip, ErrorText, Field, inputCls, PageHeader } from '../components/ui'
import { State } from '../components/State'
import ReturnDialog, { type ReturnableInvoice } from '../components/ReturnDialog'

type Tab = 'new' | 'archive' | 'warranty'
type Row = {
  id: string; return_number: string; business_date: string; created_at: string; status: 'completed' | 'pending_approval' | 'rejected'; reason: string
  refund_method: keyof typeof METHOD_AR | 'credit'; refund_total: string; debt_reduction: string; manual_reduction: string; invoice_number: string
  customer_name: string | null; items: number; pending_inspection: number
}
type Warranty = { kind: 'sale' | 'repair'; ref: string; item: string; customer: string; since: string | null; warranty_until: string | null; is_valid: boolean; days_left: number; serial: string | null }

const STATUS = { completed: { l: 'مكتمل', t: 'ok' }, pending_approval: { l: 'بانتظار الموافقة', t: 'warn' }, rejected: { l: 'مرفوض', t: 'neutral' } } as const
const METHOD_LABEL = { ...METHOD_AR, credit: 'على حساب العميل' } as const

function NewReturn() {
  const [term, setTerm] = useState('')
  const [chosen, setChosen] = useState<ReturnableInvoice | null>(null)
  const search = useMutation({
    mutationFn: async () => {
      const { data: ids, error } = await supabase.rpc('find_returnable_invoices', { p_term: term })
      if (error) throw error
      const list = (ids as unknown as string[]) ?? []
      if (list.length === 0) return []
      const { data, error: e2 } = await supabase.from('sales_invoices')
        .select('id,invoice_number,customer_id,customer_name,customer_phone,subtotal,total,created_at,sales_invoice_lines(id,name_snapshot,qty,unit_price,serials),sales_payments(method)')
        .in('id', list).order('created_at', { ascending: false })
      if (e2) throw e2
      return data as unknown as (ReturnableInvoice & { customer_name: string | null; customer_phone: string | null; created_at: string })[]
    },
  })
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); search.mutate() }}>
        <Field label="رقم الفاتورة أو الهاتف أو اسم العميل أو IMEI أو الباركود" className="min-w-0 flex-1 sm:max-w-xl">
          <input className={inputCls} dir="auto" autoFocus value={term} onChange={(e) => setTerm(e.target.value)} maxLength={60} />
        </Field>
        <Button variant="primary" disabled={search.isPending || term.trim().length < 3}>{search.isPending ? 'جارٍ البحث…' : 'بحث'}</Button>
      </form>
      <ErrorText error={search.error} />
      {search.data?.length === 0 && <State kind="empty" title="لا توجد فاتورة مطابقة" text="جرّب رقم الفاتورة أو IMEI الجهاز." />}
      <div className="space-y-2">
        {search.data?.map((i) => (
          <Card key={i.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-semibold"><bdi>{i.invoice_number}</bdi> <span className="font-normal text-muted">· {formatCairo(i.created_at)}</span></p>
              <p className="text-muted" dir="auto">{i.customer_name ?? 'بدون عميل'}{i.customer_phone ? ` · ${i.customer_phone}` : ''} · {i.sales_invoice_lines.length} صنف · {formatEGP(toMinor(i.total))}</p>
            </div>
            {i.sales_payments.some((p) => p.method === 'credit') && <Chip tone="warn">فيها آجل</Chip>}
            <Button variant="primary" onClick={() => setChosen(i)}>إرجاع أصناف</Button>
          </Card>
        ))}
      </div>
      {chosen && <ReturnDialog inv={chosen} onClose={() => { setChosen(null); search.mutate() }} />}
    </div>
  )
}

function Archive() {
  const [day, setDay] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const rows = useQuery({
    queryKey: ['returns', 'archive'],
    queryFn: async () => {
      const { data, error } = await supabase.from('returns_archive').select('*').order('created_at', { ascending: false }).limit(400)
      if (error) throw error
      return data as Row[]
    },
  })
  const today = cairoBusinessDate()
  const all = rows.data ?? []
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
  const shown = all.filter((r) => (!day || r.business_date === day) && (!status || r.status === status)
    && (!q.trim() || [r.return_number, r.invoice_number, r.customer_name ?? '', r.reason].some((x) => x.toLowerCase().includes(q.trim().toLowerCase()))))
  const sum = (xs: Row[]) => xs.filter((r) => r.status === 'completed').reduce((s, r) => s + toMinor(r.refund_total) + toMinor(r.debt_reduction), 0)
  return (
    <div className="space-y-4">
      <div className="stagger grid gap-3 sm:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted">مرتجعات اليوم</p><p className="mt-1 text-2xl font-bold">{formatEGP(sum(all.filter((r) => r.business_date === today)))}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">آخر 7 أيام</p><p className="mt-1 text-2xl font-bold">{formatEGP(sum(all.filter((r) => r.business_date >= weekAgo)))}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">بانتظار الموافقة</p><p className="mt-1 text-2xl font-bold">{all.filter((r) => r.status === 'pending_approval').length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">قطع تحت الفحص</p><p className="mt-1 text-2xl font-bold">{all.reduce((s, r) => s + r.pending_inspection, 0)}</p></Card>
      </div>
      <div className="flex flex-wrap gap-2">
        <input type="date" className={`${inputCls} sm:w-44`} dir="ltr" aria-label="اليوم" value={day} onChange={(e) => setDay(e.target.value)} />
        <select className={`${inputCls} sm:w-44`} aria-label="الحالة" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </select>
        <input className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`} placeholder="بحث برقم المرتجع أو الفاتورة أو العميل" aria-label="بحث" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button onClick={() => downloadCsv('returns.csv', ['رقم المرتجع', 'التاريخ', 'الفاتورة', 'العميل', 'الأصناف', 'طريقة الرد', 'المدفوع', 'من الدين', 'خصم محتفظ به', 'السبب', 'الحالة'],
          shown.map((r) => [r.return_number, r.business_date, r.invoice_number, r.customer_name ?? '', r.items, METHOD_LABEL[r.refund_method], r.refund_total, r.debt_reduction, r.manual_reduction, r.reason, STATUS[r.status].l]))}>تصدير CSV</Button>
      </div>
      {rows.isLoading && <State kind="loading" />}
      {rows.isError && <State kind="error" text="تعذّر تحميل المرتجعات." />}
      {rows.data && shown.length === 0 && <State kind="empty" title="لا توجد مرتجعات" />}
      {shown.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-muted"><tr className="border-b border-line">{['المرتجع', 'الفاتورة', 'العميل', 'الأصناف', 'المدفوع', 'من الدين', 'الخصم', 'السبب', 'الحالة'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="p-3 font-mono text-xs" dir="ltr">{r.return_number}<p className="font-sans text-muted">{formatCairo(r.created_at)}</p></td>
                  <td className="p-3 font-mono text-xs" dir="ltr">{r.invoice_number}</td>
                  <td className="p-3" dir="auto">{r.customer_name ?? '—'}</td>
                  <td className="p-3">{r.items}{r.pending_inspection > 0 && <Chip tone="warn">فحص {r.pending_inspection}</Chip>}</td>
                  <td className="p-3">{toMinor(r.refund_total) ? <>{formatEGP(toMinor(r.refund_total))}<p className="text-xs text-muted">{METHOD_LABEL[r.refund_method]}</p></> : '—'}</td>
                  <td className="p-3">{toMinor(r.debt_reduction) ? formatEGP(toMinor(r.debt_reduction)) : '—'}</td>
                  <td className="p-3">{toMinor(r.manual_reduction) ? formatEGP(toMinor(r.manual_reduction)) : '—'}</td>
                  <td className="p-3" dir="auto">{r.reason}</td>
                  <td className="p-3"><Chip tone={STATUS[r.status].t}>{STATUS[r.status].l}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function WarrantyTab() {
  const [term, setTerm] = useState('')
  const search = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('check_warranty', { p_term: term })
      if (error) throw error
      return data as Warranty[]
    },
  })
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); search.mutate() }}>
        <Field label="IMEI أو السيريال أو رقم الفاتورة أو رقم أمر الصيانة (RP-12)" className="min-w-0 flex-1 sm:max-w-xl">
          <input className={inputCls} dir="ltr" autoFocus value={term} onChange={(e) => setTerm(e.target.value)} maxLength={40} />
        </Field>
        <Button variant="primary" disabled={search.isPending || term.trim().length < 5}>{search.isPending ? 'جارٍ البحث…' : 'فحص الضمان'}</Button>
      </form>
      <ErrorText error={search.error} />
      {search.data?.length === 0 && <State kind="empty" title="لا يوجد جهاز مباع أو مُسلَّم بهذا الرقم" />}
      <div className="space-y-2">
        {search.data?.map((r, i) => (
          <Card key={`${r.ref}-${i}`} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-semibold" dir="auto">{r.item} <Chip tone="info">{r.kind === 'sale' ? 'بيع' : 'صيانة'}</Chip></p>
              <p className="text-muted"><bdi>{r.ref}</bdi> · {r.customer || 'بدون اسم'}{r.serial ? ` · ${r.serial}` : ''}{r.since ? ` · من ${r.since}` : ''}</p>
            </div>
            {r.warranty_until ? (r.is_valid ? <Chip tone="ok">ساري حتى {r.warranty_until} ({r.days_left} يوم)</Chip> : <Chip tone="danger">منتهي في {r.warranty_until}</Chip>) : <Chip>بدون ضمان</Chip>}
          </Card>
        ))}
      </div>
    </div>
  )
}

export default function Returns() {
  const [tab, setTab] = useState<Tab>('new')
  const tabs: { key: Tab; label: string }[] = [{ key: 'new', label: 'مرتجع جديد' }, { key: 'archive', label: 'أرشيف المرتجعات' }, { key: 'warranty', label: 'فحص الضمان' }]
  return (
    <div>
      <PageHeader title="مرتجعات العملاء" subtitle="ابحث عن الفاتورة، ارجع الأصناف بحالتها، واعرف الضمان من مكان واحد." />
      <div role="tablist" aria-label="أقسام المرتجعات" className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition active:scale-[0.97] ${tab === t.key ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'new' && <NewReturn />}
      {tab === 'archive' && <Archive />}
      {tab === 'warranty' && <WarrantyTab />}
    </div>
  )
}
