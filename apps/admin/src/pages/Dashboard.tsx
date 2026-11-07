import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { METHOD_AR, useProducts, useStock } from '../lib/data'
import { formatEGP } from '../lib/money'
import { cairoBusinessDate } from '../lib/time'
import { Card, Chip, inputCls, PageHeader } from '../components/ui'

type Summary = {
  from: string; to: string; sales: number; sales_gross: number; returns: number; returns_count: number
  returns_awaiting_inspection: number; invoices: number; cogs: number; gross_profit: number
  lines_missing_cost: number; expenses: number; expenses_paid: number; expenses_due_all: number
  net_estimate: number; pending_approvals: number; pending_sales: number; by_method: Record<string, number>
}
type Preset = 'today' | 'month' | 'custom'

const toE = (n: number) => formatEGP(Math.round(n * 100))
const day = (s: string) => new Date(`${s}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86400000))

/** The range this period is compared against (plan: same weekday last week / same day-count of last month). */
function prevRange(p: Preset, from: string, to: string): { from: string; to: string; label: string } {
  if (p === 'today') return { from: addDays(from, -7), to: addDays(to, -7), label: 'نفس اليوم من الأسبوع الماضي' }
  if (p === 'month') {
    const [y, m, d] = to.split('-').map(Number)
    const lastPrev = new Date(Date.UTC(y, m - 1, 0)).getUTCDate()
    const pm = new Date(Date.UTC(y, m - 2, 1))
    const base = iso(pm).slice(0, 8)
    return { from: `${base}01`, to: `${base}${String(Math.min(d, lastPrev)).padStart(2, '0')}`, label: 'نفس عدد الأيام من الشهر السابق' }
  }
  const len = Math.round((day(to).getTime() - day(from).getTime()) / 86400000) + 1
  return { from: addDays(from, -len), to: addDays(from, -1), label: 'الفترة السابقة بنفس الطول' }
}

function Stat({ to, label, value, hint, tone, children }: { to?: string; label: string; value: string | number; hint?: string; tone?: 'warn'; children?: React.ReactNode }) {
  const body = (
    <Card className={`h-full p-5 ${to ? 'transition hover:border-accent' : ''}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${tone === 'warn' && Number(value) > 0 ? 'text-warn' : ''}`}>{value}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {children}
    </Card>
  )
  return to ? <Link to={to} className="block">{body}</Link> : body
}

function OwnerSection() {
  const [preset, setPreset] = useState<Preset>('month')
  const today = cairoBusinessDate()
  const [custom, setCustom] = useState({ from: today, to: today })

  const range = preset === 'today' ? { from: today, to: today } : preset === 'month' ? { from: `${today.slice(0, 8)}01`, to: today } : custom
  const prev = prevRange(preset, range.from, range.to)
  const valid = range.from && range.to && range.to >= range.from

  const cur = useQuery({
    queryKey: ['owner-summary', range.from, range.to],
    enabled: !!valid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('owner_summary', { p_from: range.from, p_to: range.to })
      if (error) throw error
      return data as Summary
    },
  })
  const old = useQuery({
    queryKey: ['owner-summary', prev.from, prev.to],
    enabled: !!valid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('owner_summary', { p_from: prev.from, p_to: prev.to })
      if (error) throw error
      return data as Summary
    },
  })

  const sup = useQuery({
    queryKey: ['supplier-balances', 'dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_balances').select('balance,overdue')
      if (error) throw error
      const rows = data as { balance: number | string; overdue: number | string }[]
      return {
        owed: rows.reduce((a, r) => a + Math.max(Number(r.balance), 0), 0),
        overdue: rows.reduce((a, r) => a + Number(r.overdue), 0),
      }
    },
  })

  const s = cur.data
  const diff = s && old.data ? s.sales - old.data.sales : null
  const pct = s && old.data && old.data.sales > 0 ? ((s.sales - old.data.sales) / old.data.sales) * 100 : null

  return (
    <section aria-label="أرقام المحل" className="mb-8 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {([['today', 'اليوم'], ['month', 'الشهر حتى الآن'], ['custom', 'فترة مخصصة']] as const).map(([k, l]) => (
          <button key={k} aria-pressed={preset === k} onClick={() => setPreset(k)}
            className={`rounded-lg px-3 py-2 text-sm ${preset === k ? 'bg-accent text-accent-fg' : 'border border-line bg-surface'}`}>{l}</button>
        ))}
        {preset === 'custom' && (
          <>
            <input type="date" className={`${inputCls} !w-40`} dir="ltr" aria-label="من" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <input type="date" className={`${inputCls} !w-40`} dir="ltr" aria-label="إلى" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </>
        )}
        <span className="text-xs text-muted">الفترة: {range.from} → {range.to}</span>
      </div>

      {!valid && <p className="text-sm text-danger">اختر فترة صحيحة.</p>}
      {cur.isError && <p role="alert" className="text-sm text-danger">تعذّر تحميل الأرقام. تأكد أن آخر تحديثات قاعدة البيانات مطبقة.</p>}
      {cur.isLoading && <p className="text-sm text-muted">جارٍ التحميل…</p>}

      {s && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat to="/transactions?kind=sale" label="صافي المبيعات" value={toE(s.sales)} hint={`${s.invoices} فاتورة مكتملة${s.returns > 0 ? ` · بعد مرتجعات ${toE(s.returns)}` : ''}`}>
            {old.data && (
              <p className="mt-2 text-xs text-muted">
                {pct !== null
                  ? <><Chip tone={pct >= 0 ? 'ok' : 'danger'}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%</Chip> مقارنة بـ {prev.label} ({toE(old.data.sales)})</>
                  : <>لا توجد نسبة قابلة للحساب (الفترة السابقة {toE(old.data.sales)}). الفرق: {toE(diff ?? 0)}</>}
              </p>
            )}
          </Stat>
          <Stat label="مجمل الربح" value={toE(s.gross_profit)} hint={s.lines_missing_cost > 0 ? `تقدير: التكلفة ناقصة في ${s.lines_missing_cost} بند` : `تكلفة البضاعة ${toE(s.cogs)}`} />
          <Stat to="/expenses" label="المصروفات" value={toE(s.expenses)} hint={`مدفوع ${toE(s.expenses_paid)} · إجمالي المتبقي للسداد ${toE(s.expenses_due_all)}`} />
          <Stat label="صافي الربح (تقديري)" value={toE(s.net_estimate)} hint="مجمل الربح − المصروفات. لا يشمل المرتبات بعد." />
          {sup.data && <Stat to="/supplier-accounts" label="مستحقات الموردين" value={toE(sup.data.owed)} hint={sup.data.overdue > 0 ? `منها متأخر ${toE(sup.data.overdue)}` : 'لا يوجد متأخر'} />}
          {s.returns_awaiting_inspection > 0 && <Stat to="/inventory" label="مرتجعات تحت الفحص" value={s.returns_awaiting_inspection} hint="قطع لم تُعتمد للبيع بعد" tone="warn" />}
          <Stat to="/approvals" label="محتاج قرارك" value={s.pending_approvals} hint={s.pending_sales ? `منها ${s.pending_sales} فاتورة بخصم كبير` : 'طلبات موافقة معلّقة'} tone="warn" />
          <Card className="p-5 sm:col-span-2">
            <p className="text-sm text-muted">المبيعات حسب طريقة الدفع</p>
            {Object.keys(s.by_method).length === 0 ? <p className="mt-2 text-sm text-muted">لا توجد مبيعات في الفترة.</p> : (
              <ul className="mt-2 grid grid-cols-2 gap-2 text-sm">
                {Object.entries(s.by_method).map(([m, v]) => <li key={m} className="flex justify-between rounded-lg bg-bg px-3 py-2"><span>{METHOD_AR[m as keyof typeof METHOD_AR] ?? m}</span><span className="font-semibold">{toE(v)}</span></li>)}
              </ul>
            )}
          </Card>
        </div>
      )}
    </section>
  )
}

export default function Dashboard() {
  const { hasRole, fullName } = useAuth()
  const isOwnerView = hasRole('owner', 'accountant')
  const canApprovals = hasRole('owner', 'manager', 'accountant')
  const canBuying = hasRole('owner', 'manager', 'accountant', 'warehouse')
  const canWeb = hasRole('owner', 'manager', 'cashier', 'warehouse')

  const count = (key: string, table: string, col: string, vals: string[], enabled: boolean) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: [key, 'count'], enabled,
      queryFn: async () => {
        const { count: c, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).in(col, vals)
        if (error) throw error
        return c ?? 0
      },
    })
  const pending = count('approvals', 'approval_requests', 'status', ['submitted'], canApprovals)
  const openPOs = count('pos', 'purchase_orders', 'status', ['pending_approval', 'approved', 'sent', 'partially_received'], canBuying)
  const web = count('online-orders', 'online_orders', 'status', ['reserved'], canWeb)
  const products = useProducts()
  const stock = useStock()

  const low = (products.data ?? []).flatMap((p) => p.variants).filter(
    (v) => v.is_active && v.reorder_level > 0 && (stock.data?.get(v.id) ?? 0) <= v.reorder_level,
  ).length
  const units = [...(stock.data?.values() ?? [])].reduce((a, b) => a + b, 0)
  const fmt = (q: { isLoading: boolean; isError: boolean; data?: number }) => (q.isLoading ? '…' : q.isError ? '—' : (q.data ?? 0))

  return (
    <div>
      <PageHeader title={`أهلاً ${fullName}`} subtitle="ملخص سريع لما يحتاج انتباهك اليوم." />
      {isOwnerView && <OwnerSection />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {canApprovals && !isOwnerView && <Stat to="/approvals" label="محتاج قرارك" value={fmt(pending)} hint="طلبات موافقة معلّقة" tone="warn" />}
        {canBuying && <Stat to="/purchase-orders" label="طلبات شراء مفتوحة" value={fmt(openPOs)} hint="بانتظار موافقة أو إرسال أو استلام" />}
        {canWeb && <Stat to="/online-orders" label="طلبات موقع جديدة" value={fmt(web)} hint="حجوزات بانتظار التأكيد" tone="warn" />}
        <Stat to="/inventory" label="أصناف قرب تنتهي" value={products.isLoading || stock.isLoading ? '…' : low} hint="تحت حد إعادة الطلب" tone="warn" />
        <Stat to="/inventory" label="الوحدات في المخزون" value={stock.isLoading ? '…' : units} hint="كل الأصناف" />
      </div>
    </div>
  )
}
