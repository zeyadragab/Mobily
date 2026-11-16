import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { CancelDialog, CustomerPicker, Kpi, NoShiftHint } from '../components/WalletBits'
import { useAccounts } from '../lib/accounts'
import { useCustomers } from '../lib/customers'
import { useOpenSession } from '../lib/data'
import { newKey, useDrawerBalances } from '../lib/drawers'
import {
  INST_STATUS, money, PAY_METHODS, PERIOD, PLAN_STATUS, PLAN_TONE, useCollections, useCreditInvoices, useInstallmentsDue, usePlans,
  type InstallmentRow, type PayMethod,
} from '../lib/installments'
import { formatEGP, toMinor } from '../lib/money'
import { downloadCsv } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { cairoBusinessDate, formatCairo } from '../lib/time'

const m = (v: number | string) => formatEGP(toMinor(v))

export default function Installments() {
  const { hasRole } = useAuth()
  const boss = hasRole('owner', 'manager')
  const qc = useQueryClient()
  const session = useOpenSession()
  const due = useInstallmentsDue()
  const plans = usePlans()
  const collections = useCollections()
  const [tab, setTab] = useState<'due' | 'plans' | 'collections'>('due')
  const [show, setShow] = useState<'overdue' | 'open'>('overdue')
  const [find, setFind] = useState('')
  const [collect, setCollect] = useState<InstallmentRow | null>(null)
  const [newPlan, setNewPlan] = useState(false)
  const [cancelPlan, setCancelPlan] = useState<{ id: string; no: string } | null>(null)
  const [cancelCol, setCancelCol] = useState<{ id: string; no: string } | null>(null)
  const today = cairoBusinessDate()
  const [weekEnd] = useState(() => cairoBusinessDate(new Date(Date.now() + 7 * 86400000)))

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['installments-due'] }), qc.invalidateQueries({ queryKey: ['installment-plans'] }),
    qc.invalidateQueries({ queryKey: ['installment-collections'] }), qc.invalidateQueries({ queryKey: ['customers'] }),
    qc.invalidateQueries({ queryKey: ['credit-invoices'] }), qc.invalidateQueries({ queryKey: ['drawers'] }),
    qc.invalidateQueries({ queryKey: ['accounts'] }),
  ])

  const open = useMemo(() => (due.data ?? []).filter((r) => r.plan_status === 'active' && (r.status === 'due' || r.status === 'partial')), [due.data])
  const overdue = open.filter((r) => r.overdue)
  const week = open.filter((r) => !r.overdue && r.due_date <= weekEnd)
  const sum = (rows: InstallmentRow[]) => rows.reduce((s, r) => s + toMinor(r.remaining), 0)
  const collectedToday = (collections.data ?? []).filter((c) => c.status === 'active' && cairoBusinessDate(new Date(c.created_at)) === today)
    .reduce((s, c) => s + toMinor(c.amount), 0)
  const list = open.filter((r) => (show === 'open' || r.overdue)
    && (!find.trim() || `${r.customer_name} ${r.customer_phone} ${r.plan_no}`.toLowerCase().includes(find.trim().toLowerCase())))

  return (
    <div>
      <PageHeader title="الأقساط" subtitle="خطط تقسيط العملاء ومواعيد الاستحقاق وتحصيل الأقساط."
        actions={<>
          <Button onClick={() => downloadCsv('installments.csv', ['الخطة', 'العميل', 'الموبايل', 'القسط', 'الاستحقاق', 'المبلغ', 'المدفوع', 'المتبقي', 'أيام التأخير'],
            open.map((r) => [r.plan_no, r.customer_name, r.customer_phone, `${r.seq}/${r.installment_count}`, r.due_date, r.amount, r.paid, r.remaining, r.days_late]))}>تصدير CSV</Button>
          <Button variant="primary" onClick={() => setNewPlan(true)}>+ خطة تقسيط</Button>
        </>} />
      {session.isSuccess && !session.data && <NoShiftHint />}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="أقساط متأخرة" value={`${overdue.length} · ${formatEGP(sum(overdue))}`} tone={overdue.length ? 'danger' : undefined} />
        <Kpi label="تستحق خلال 7 أيام" value={`${week.length} · ${formatEGP(sum(week))}`} tone={week.length ? 'warn' : undefined} />
        <Kpi label="خطط جارية" value={String((plans.data ?? []).filter((p) => p.status === 'active').length)} />
        <Kpi label="محصّل اليوم" value={formatEGP(collectedToday)} tone="ok" />
      </div>

      <div role="tablist" className="mb-3 flex flex-wrap gap-2">
        {([['due', 'الأقساط'], ['plans', 'الخطط'], ['collections', 'سجل التحصيل']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-full border px-4 py-1.5 text-sm ${tab === k ? 'border-accent bg-accent text-accent-fg' : 'border-line bg-surface'}`}>{l}</button>
        ))}
      </div>

      {tab === 'due' && <>
        <div className="mb-3 flex flex-wrap gap-2">
          <select aria-label="عرض" className={`${inputCls} !w-44`} value={show} onChange={(e) => setShow(e.target.value as 'overdue' | 'open')}>
            <option value="overdue">المتأخرة فقط</option><option value="open">كل الأقساط المفتوحة</option>
          </select>
          <input aria-label="بحث" className={`${inputCls} !w-64`} dir="auto" placeholder="ابحث بالعميل أو الموبايل أو رقم الخطة" value={find} onChange={(e) => setFind(e.target.value)} />
        </div>
        {due.isLoading && <State kind="loading" />}
        {due.isError && <State kind="error" text="تعذّر تحميل الأقساط." action={<Button onClick={() => void due.refetch()}>حاول تاني</Button>} />}
        {due.isSuccess && list.length === 0 && <State kind="empty" title={show === 'overdue' ? 'لا توجد أقساط متأخرة' : 'لا توجد أقساط مفتوحة'} />}
        {list.length > 0 && <Card className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-line text-muted">
            {['العميل', 'الخطة', 'القسط', 'الاستحقاق', 'المبلغ', 'المتبقي', 'الحالة', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h}</th>)}
          </tr></thead>
          <tbody>{list.map((r) => <tr key={r.id} className="border-b border-line last:border-0">
            <td className="p-3"><p dir="auto">{r.customer_name}</p><bdi className="text-xs text-muted">{r.customer_phone}</bdi></td>
            <td className="p-3"><bdi>{r.plan_no}</bdi>{r.description && <p className="text-xs text-muted" dir="auto">{r.description}</p>}</td>
            <td className="p-3">{r.seq} / {r.installment_count}</td>
            <td className="p-3">{r.due_date}</td>
            <td className="p-3">{m(r.amount)}</td>
            <td className="p-3 font-semibold">{m(r.remaining)}</td>
            <td className="p-3">{r.overdue ? <Chip tone="danger">متأخر {r.days_late} يوم</Chip> : <Chip tone={r.status === 'partial' ? 'warn' : 'info'}>{INST_STATUS[r.status]}</Chip>}</td>
            <td className="p-3"><Button small variant="primary" onClick={() => setCollect(r)}>تحصيل</Button></td>
          </tr>)}</tbody>
        </table></Card>}
      </>}

      {tab === 'plans' && <>
        {plans.isLoading && <State kind="loading" />}
        {plans.isSuccess && plans.data.length === 0 && <State kind="empty" title="لا توجد خطط تقسيط بعد" />}
        {!!plans.data?.length && <Card className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b border-line text-muted">
            {['الخطة', 'العميل', 'الأصل', 'الفائدة', 'المقدم', 'الأقساط', 'تاريخ الإنشاء', 'الحالة', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h}</th>)}
          </tr></thead>
          <tbody>{plans.data.map((p) => <tr key={p.id} className="border-b border-line last:border-0">
            <td className="p-3"><bdi>{p.plan_no}</bdi>{p.invoice_id && <p className="text-xs text-muted">من فاتورة</p>}</td>
            <td className="p-3" dir="auto">{p.customers?.name}</td>
            <td className="p-3">{m(p.principal)}</td><td className="p-3">{m(p.interest)}</td><td className="p-3">{m(p.down_payment)}</td>
            <td className="p-3">{p.installment_count} × {PERIOD[p.period]}</td>
            <td className="p-3">{formatCairo(p.created_at)}</td>
            <td className="p-3"><Chip tone={PLAN_TONE[p.status]}>{PLAN_STATUS[p.status]}</Chip>{p.cancel_reason && <p className="text-xs text-muted" dir="auto">{p.cancel_reason}</p>}</td>
            <td className="p-3">{boss && p.status === 'active' && <Button small variant="danger" onClick={() => setCancelPlan({ id: p.id, no: p.plan_no })}>إلغاء الخطة</Button>}</td>
          </tr>)}</tbody>
        </table></Card>}
      </>}

      {tab === 'collections' && <>
        {collections.isLoading && <State kind="loading" />}
        {collections.isSuccess && collections.data.length === 0 && <State kind="empty" title="لا يوجد تحصيل بعد" />}
        {!!collections.data?.length && <Card className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-line text-muted">
            {['الإيصال', 'الخطة', 'العميل', 'المبلغ', 'الطريقة', 'التاريخ', 'الحالة', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h}</th>)}
          </tr></thead>
          <tbody>{collections.data.map((c) => <tr key={c.id} className="border-b border-line last:border-0">
            <td className="p-3"><bdi>{c.receipt_no}</bdi></td><td className="p-3"><bdi>{c.installment_plans?.plan_no}</bdi></td>
            <td className="p-3" dir="auto">{c.customers?.name}</td><td className="p-3">{m(c.amount)}</td><td className="p-3">{PAY_METHODS[c.method]}</td>
            <td className="p-3">{formatCairo(c.created_at)}</td>
            <td className="p-3">{c.status === 'cancelled' ? <Chip tone="danger">ملغي</Chip> : <Chip tone="ok">تم</Chip>}{c.cancel_reason && <p className="text-xs text-muted" dir="auto">{c.cancel_reason}</p>}</td>
            <td className="p-3">{boss && c.status === 'active' && <Button small variant="danger" onClick={() => setCancelCol({ id: c.id, no: c.receipt_no })}>إلغاء</Button>}</td>
          </tr>)}</tbody>
        </table></Card>}
      </>}

      {collect && <CollectDialog row={collect} onClose={() => setCollect(null)} onDone={async () => { setCollect(null); await refresh() }} />}
      {newPlan && <PlanDialog onClose={() => setNewPlan(false)} onDone={async () => { setNewPlan(false); await refresh() }} />}
      {cancelPlan && <CancelDialog title={`إلغاء الخطة ${cancelPlan.no}`} text="بيتلغى التقسيط ويتشال المقدم والفائدة من حساب العميل. مينفعش لو فيه تحصيل متسجل عليها."
        run={async (reason) => { const { error } = await supabase.rpc('cancel_installment_plan', { p_plan: cancelPlan.id, p_reason: reason }); if (error) throw error }}
        onClose={() => setCancelPlan(null)} onDone={async () => { setCancelPlan(null); await refresh() }} />}
      {cancelCol && <CancelDialog title={`إلغاء التحصيل ${cancelCol.no}`} text="المبلغ بيرجع من الدرج أو الحساب، والقسط يرجع مستحق، والدين يرجع على العميل. محتاج وردية مفتوحة."
        run={async (reason) => { const { error } = await supabase.rpc('cancel_installment_collection', { p_collection: cancelCol.id, p_reason: reason }); if (error) throw error }}
        onClose={() => setCancelCol(null)} onDone={async () => { setCancelCol(null); await refresh() }} />}
    </div>
  )
}

function CollectDialog({ row, onClose, onDone }: { row: InstallmentRow; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(Number(row.remaining)))
  const [method, setMethod] = useState<PayMethod>('cash')
  const [drawer, setDrawer] = useState('installments')
  const [account, setAccount] = useState('')
  const [key] = useState(newKey)
  const drawers = useDrawerBalances()
  const accounts = useAccounts(method !== 'cash')
  const save = useMutation({
    mutationFn: async () => {
      const amt = money(amount)
      if (method !== 'cash' && !account) throw new Error('اختر المحفظة أو الماكينة اللي هتستلم المبلغ.')
      const { error } = await supabase.rpc('collect_installment', {
        p_installment: row.id, p_amount: amt, p_method: method, p_drawer: method === 'cash' ? drawer : null,
        p_account: method === 'cash' ? null : account, p_idem: key,
      })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  const list = (accounts.data ?? []).filter((a) => a.is_active)
  return (
    <Modal open onClose={onClose} title={`تحصيل قسط ${row.seq}/${row.installment_count} · ${row.plan_no}`}
      footer={<><Button onClick={onClose}>رجوع</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ التحصيل…' : 'تأكيد التحصيل'}</Button></>}>
      <div className="space-y-3 text-sm">
        <p><span dir="auto">{row.customer_name}</span> · المتبقي من القسط <b>{m(row.remaining)}</b></p>
        <ErrorText error={save.error} />
        <Field label="المبلغ المحصّل"><input className={inputCls} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="طريقة الدفع">
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
            {Object.entries(PAY_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {method === 'cash'
          ? <Field label="الدرج اللي يدخله المبلغ">
            <select className={inputCls} value={drawer} onChange={(e) => setDrawer(e.target.value)}>
              {(drawers.data ?? []).filter((d) => d.code !== 'safe').map((d) => <option key={d.id} value={d.code}>{d.name} · {formatEGP(toMinor(d.balance))}</option>)}
            </select>
          </Field>
          : <Field label="الحساب اللي يستلم المبلغ" hint={list.length === 0 ? 'أضف محفظة أو ماكينة من صفحة الأرصدة.' : undefined}>
            <select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">اختر الحساب</option>
              {list.map((a) => <option key={a.id} value={a.id}>{a.name} · {formatEGP(toMinor(a.balance))}</option>)}
            </select>
          </Field>}
      </div>
    </Modal>
  )
}

function PlanDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { hasRole } = useAuth()
  const boss = hasRole('owner', 'manager')
  const customers = useCustomers()
  const [mode, setMode] = useState<'invoice' | 'manual'>(boss ? 'manual' : 'invoice')
  const invoices = useCreditInvoices(mode === 'invoice')
  const [invoice, setInvoice] = useState('')
  const [cust, setCust] = useState<string | null>(null)
  const [principal, setPrincipal] = useState('')
  const [interest, setInterest] = useState('')
  const [down, setDown] = useState('')
  const [count, setCount] = useState('6')
  const [period, setPeriod] = useState<'week' | 'month'>('month')
  const [first, setFirst] = useState(cairoBusinessDate())
  const [desc, setDesc] = useState('')
  const [key] = useState(newKey)
  const save = useMutation({
    mutationFn: async () => {
      const n = Number(count)
      if (!Number.isInteger(n) || n < 1 || n > 60) throw new Error('عدد الأقساط من 1 إلى 60.')
      if (mode === 'invoice' && !invoice) throw new Error('اختر الفاتورة الآجلة.')
      if (mode === 'manual' && !cust) throw new Error('اختر العميل.')
      const { error } = await supabase.rpc('create_installment_plan', {
        p_customer: mode === 'manual' ? cust : null, p_invoice: mode === 'invoice' ? invoice : null, p_description: desc.trim() || null,
        p_principal: mode === 'manual' ? money(principal) : 0, p_interest: money(interest, { zero: true }),
        p_down: mode === 'manual' ? money(down, { zero: true }) : 0, p_count: n, p_period: period, p_first_due: first, p_idem: key,
      })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  // live preview of the schedule: (principal + interest - down) / n, the last one takes the rest
  let preview = ''
  try {
    const base = mode === 'manual' ? toMinor(principal || '0') : 0
    const total = base + toMinor(interest || '0') - toMinor(down || '0')
    const n = Number(count)
    if (mode === 'manual' && total > 0 && Number.isInteger(n) && n >= 1) {
      const each = Math.round(total / n)
      preview = `${n} قسط: ${formatEGP(each)} لكل قسط والأخير ${formatEGP(total - each * (n - 1))} (الإجمالي ${formatEGP(total)})`
    }
  } catch { preview = '' }
  return (
    <Modal open wide onClose={onClose} title="خطة تقسيط جديدة"
      footer={<><Button onClick={onClose}>رجوع</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ الحفظ…' : 'إنشاء الخطة'}</Button></>}>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex gap-2 sm:col-span-2">
          <Button small variant={mode === 'invoice' ? 'primary' : 'ghost'} onClick={() => setMode('invoice')}>من فاتورة آجلة</Button>
          {boss && <Button small variant={mode === 'manual' ? 'primary' : 'ghost'} onClick={() => setMode('manual')}>خطة يدوية</Button>}
        </div>
        <div className="sm:col-span-2"><ErrorText error={save.error} /></div>
        {mode === 'invoice'
          ? <Field label="الفاتورة الآجلة" className="sm:col-span-2" hint="الدين موجود على العميل من الفاتورة؛ هنا بنجدوله ونضيف الفائدة لو فيه.">
            <select className={inputCls} value={invoice} onChange={(e) => setInvoice(e.target.value)}>
              <option value="">{invoices.isLoading ? 'جارٍ التحميل…' : 'اختر الفاتورة'}</option>
              {(invoices.data ?? []).map((i) => <option key={i.id} value={i.id}>#{i.invoice_number} · {i.customer_name} · آجل {m(i.credit)}</option>)}
            </select>
          </Field>
          : <>
            <div className="sm:col-span-2"><CustomerPicker customers={customers.data ?? []} loading={customers.isLoading} value={cust} onChange={setCust} required /></div>
            <Field label="أصل المبلغ"><input className={inputCls} dir="ltr" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} /></Field>
            <Field label="المقدم (يدخل درج المنتجات الآن)"><input className={inputCls} dir="ltr" inputMode="decimal" placeholder="0" value={down} onChange={(e) => setDown(e.target.value)} /></Field>
          </>}
        <Field label="الفائدة (مبلغ ثابت)"><input className={inputCls} dir="ltr" inputMode="decimal" placeholder="0" value={interest} onChange={(e) => setInterest(e.target.value)} /></Field>
        <Field label="عدد الأقساط"><input className={inputCls} dir="ltr" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></Field>
        <Field label="الدورية">
          <select className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value as 'week' | 'month')}>
            {Object.entries(PERIOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="تاريخ أول قسط" hint="بالتوقيت المحلي. الأقساط الشهرية بتتعدل لآخر يوم في الشهر لو لازم."><input className={inputCls} type="date" dir="ltr" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <Field label="وصف (اختياري)" className="sm:col-span-2"><input className={inputCls} dir="auto" maxLength={200} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        {preview && <p className="rounded-lg bg-bg px-3 py-2 text-muted sm:col-span-2">{preview}</p>}
      </div>
    </Modal>
  )
}
