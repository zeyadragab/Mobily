import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { CancelDialog, CustomerPicker, Kpi, NoShiftHint, RangeFilter } from '../components/WalletBits'
import { ACCOUNT_KIND, useAccounts, type MoneyAccount } from '../lib/accounts'
import { useCustomers, type Customer } from '../lib/customers'
import { useOpenSession } from '../lib/data'
import { newKey, useDrawerBalances } from '../lib/drawers'
import { formatEGP, toMinor } from '../lib/money'
import { downloadCsv } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { cairoBusinessDate, formatCairo } from '../lib/time'
import {
  BILL_KIND, BILL_PAY, BILL_STATUS, egp, opError, parseAmount, printBillReceipt, rangeOf, softAmount, toDb, useBillOps, useBillServices,
  type BillOp, type BillService, type RangePreset,
} from '../lib/walletOps'

type Tab = 'bill' | 'machine'

export default function Bills() {
  const { hasRole } = useAuth()
  const boss = hasRole('owner', 'manager')
  const canOperate = hasRole('owner', 'manager', 'cashier')
  const qc = useQueryClient()
  const session = useOpenSession()
  const accounts = useAccounts()
  const customers = useCustomers()
  const services = useBillServices()
  const drawers = useDrawerBalances()

  const today = cairoBusinessDate()
  const [preset, setPreset] = useState<RangePreset>('today')
  const [cFrom, setCFrom] = useState(today)
  const [cTo, setCTo] = useState(today)
  const range = rangeOf(preset, cFrom, cTo)
  const log = useBillOps(range.from, range.to)
  const todayOps = useBillOps(today, today)

  const [tab, setTab] = useState<Tab>('bill')
  const [kindF, setKindF] = useState<'all' | BillOp['kind']>('all')
  const [statusF, setStatusF] = useState<'all' | BillOp['status']>('all')
  const [payF, setPayF] = useState<'all' | BillOp['pay']>('all')
  const [search, setSearch] = useState('')
  const [cancelOp, setCancelOp] = useState<BillOp | null>(null)
  const [manage, setManage] = useState(false)

  const accName = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a.name])), [accounts.data])
  const custById = useMemo(() => new Map((customers.data ?? []).map((c) => [c.id, c])), [customers.data])
  const nameOfAcc = (id: string) => accName.get(id) ?? 'حساب'
  const nameOfCust = (id: string | null) => (id ? custById.get(id)?.name ?? null : null)

  const refresh = () => { ['bill-ops', 'accounts', 'drawers', 'customers', 'cash'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] })) }
  const print = (ops: BillOp[]) => { if (ops.length) printBillReceipt(ops, nameOfAcc(ops[0].account_id), nameOfCust(ops[0].customer_id)) }
  const printRow = (o: BillOp) => {
    const group = (log.data ?? []).filter((x) => x.group_id === o.group_id && x.status === o.status)
    print(group.length ? group : [o])
  }

  const kpi = useMemo(() => {
    const live = (todayOps.data ?? []).filter((o) => o.status !== 'cancelled')
    const sum = (rows: BillOp[], f: (o: BillOp) => number) => rows.reduce((s, o) => s + f(o), 0)
    const bills = live.filter((o) => o.kind === 'bill')
    return {
      count: live.length,
      bills: sum(bills, (o) => toMinor(o.amount)),
      machine: sum(live.filter((o) => o.kind === 'machine'), (o) => toMinor(o.amount)),
      commission: sum(live, (o) => toMinor(o.commission)),
      credit: sum(bills.filter((o) => o.pay === 'credit'), (o) => toMinor(o.amount) + toMinor(o.commission)),
    }
  }, [todayOps.data])

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (log.data ?? []).filter((o) => {
      if (kindF !== 'all' && o.kind !== kindF) return false
      if (statusF !== 'all' && o.status !== statusF) return false
      if (payF !== 'all' && o.pay !== payF) return false
      if (!s) return true
      const c = o.customer_id ? custById.get(o.customer_id) : undefined
      return [o.op_no, o.service_name, o.reference, accName.get(o.account_id), c?.name, c?.phone].some((v) => (v ?? '').toLowerCase().includes(s))
    })
  }, [log.data, kindF, statusF, payF, search, custById, accName])

  const exportCsv = () => downloadCsv(`bills-${range.from}_${range.to}.csv`,
    ['الرقم', 'التاريخ', 'النوع', 'الخدمة', 'الحساب', 'المبلغ', 'العمولة', 'الدفع', 'العميل', 'الرقم المرجعي', 'الحالة', 'سبب الإلغاء'],
    rows.map((o) => [o.op_no, formatCairo(o.created_at), BILL_KIND[o.kind], o.service_name, nameOfAcc(o.account_id), o.amount, o.commission,
      BILL_PAY[o.pay], nameOfCust(o.customer_id), o.reference, BILL_STATUS[o.status], o.cancel_reason]))

  const active = (accounts.data ?? []).filter((a) => a.is_active)
  const machineCash = drawers.data?.find((d) => d.code === 'machines')?.balance ?? null

  return (
    <div>
      <PageHeader title="فواتير وخدمات" subtitle="دفع فواتير وشحن للعملاء من رصيد الماكينات والمحافظ، وسحب النقدية من ماكينة الدفع."
        actions={boss && <Button onClick={() => setManage(true)}>إدارة الخدمات</Button>} />

      {session.isSuccess && !session.data && <NoShiftHint />}

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="عمليات اليوم" value={String(kpi.count)} />
        <Kpi label="فواتير مدفوعة اليوم" value={formatEGP(kpi.bills)} />
        <Kpi label="سحب ماكينات اليوم" value={formatEGP(kpi.machine)} />
        <Kpi label="عمولة اليوم" value={formatEGP(kpi.commission)} tone="ok" />
        <Kpi label="آجل اليوم" value={formatEGP(kpi.credit)} tone={kpi.credit ? 'warn' : undefined} />
      </div>

      {canOperate && <>
        <div role="tablist" aria-label="نوع العملية" className="mb-3 inline-flex rounded-xl border border-line bg-surface p-1 text-sm">
          {([['bill', 'دفع فاتورة / خدمة'], ['machine', 'سحب من ماكينة']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 font-medium transition ${tab === k ? 'btn-gel' : 'text-muted hover:text-fg'}`}>{l}</button>
          ))}
        </div>
        {accounts.isLoading && <State kind="loading" />}
        {accounts.isError && <Card className="p-6 text-center text-sm text-danger">تعذّر تحميل الحسابات. حدّث الصفحة.</Card>}
        {accounts.isSuccess && (tab === 'bill'
          ? <BillForm accounts={active} services={(services.data ?? []).filter((s) => s.is_active)} servicesState={services.isLoading ? 'loading' : services.isError ? 'error' : 'ok'}
              customers={customers.data ?? []} customersLoading={customers.isLoading} onDone={refresh} onPrint={print} />
          : <MachineForm machines={active.filter((a) => a.kind === 'machine')} drawerCash={machineCash} onDone={refresh} onPrint={print} />)}
      </>}

      <div className="mb-2 mt-6 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-bold">سجل العمليات</h2>
        <Button disabled={!rows.length} onClick={exportCsv}>تصدير CSV</Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <RangeFilter preset={preset} from={cFrom} to={cTo} onPreset={setPreset} onFrom={setCFrom} onTo={setCTo} />
        <select aria-label="النوع" className={`${inputCls} !w-40`} value={kindF} onChange={(e) => setKindF(e.target.value as typeof kindF)}>
          <option value="all">كل الأنواع</option>
          {Object.entries(BILL_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="طريقة الدفع" className={`${inputCls} !w-32`} value={payF} onChange={(e) => setPayF(e.target.value as typeof payF)}>
          <option value="all">نقدي وآجل</option>
          {Object.entries(BILL_PAY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="الحالة" className={`${inputCls} !w-32`} value={statusF} onChange={(e) => setStatusF(e.target.value as typeof statusF)}>
          <option value="all">كل الحالات</option>
          {Object.entries(BILL_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input aria-label="بحث" className={`${inputCls} min-w-40 flex-1`} dir="auto" placeholder="بحث بالرقم أو الخدمة أو المرجع أو العميل" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {range.from > range.to && <Card className="p-6 text-center text-sm text-warn">تاريخ البداية بعد تاريخ النهاية. صحّح الفترة.</Card>}
      {log.isLoading && <State kind="loading" />}
      {log.isError && <State kind="error" text="تعذّر تحميل سجل العمليات. تأكد من تطبيق آخر تحديث لقاعدة البيانات." action={<Button onClick={() => void log.refetch()}>حاول تاني</Button>} />}
      {log.isSuccess && rows.length === 0 && <Card className="p-6 text-center text-sm text-muted">
        {log.data.length ? 'لا توجد عمليات مطابقة للبحث أو الفلاتر.' : 'لا توجد عمليات في هذه الفترة.'}
      </Card>}
      {rows.length > 0 && <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b border-line text-muted">{['الرقم', 'التاريخ', 'الخدمة', 'الحساب', 'المبلغ', 'العمولة', 'الدفع / العميل', 'المرجع', 'الحالة', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h || <span className="sr-only">إجراءات</span>}</th>)}</tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id} className={`border-b border-line last:border-0 ${o.status === 'cancelled' ? 'opacity-60' : ''}`}>
              <td className="whitespace-nowrap p-3 font-medium"><bdi>{o.op_no}</bdi></td>
              <td className="whitespace-nowrap p-3">{formatCairo(o.created_at)}</td>
              <td className="p-3"><Chip tone={o.kind === 'machine' ? 'neutral' : 'info'}>{o.service_name ?? BILL_KIND[o.kind]}</Chip></td>
              <td className="p-3" dir="auto">{nameOfAcc(o.account_id)}</td>
              <td className="whitespace-nowrap p-3 font-semibold">{egp(o.amount)}</td>
              <td className="whitespace-nowrap p-3 text-ok">{egp(o.commission)}</td>
              <td className="p-3">
                <Chip tone={o.pay === 'credit' ? 'warn' : 'neutral'}>{BILL_PAY[o.pay]}</Chip>
                {nameOfCust(o.customer_id) && <span className="mt-1 block text-xs" dir="auto">{nameOfCust(o.customer_id)}</span>}
              </td>
              <td className="p-3 text-muted"><bdi>{o.reference ?? '-'}</bdi></td>
              <td className="p-3">
                <Chip tone={o.status === 'done' ? 'ok' : 'danger'}>{BILL_STATUS[o.status]}</Chip>
                {o.cancel_reason && <span className="mt-1 block max-w-44 text-xs text-muted" dir="auto">{o.cancel_reason}</span>}
              </td>
              <td className="p-3">
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Button small onClick={() => printRow(o)}>طباعة</Button>
                  {boss && o.status !== 'cancelled' && <Button small variant="danger" onClick={() => setCancelOp(o)}>إلغاء</Button>}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Card>}

      {cancelOp && <CancelDialog title={`إلغاء العملية ${cancelOp.op_no}`}
        text={`سيتم عكس أثر العملية (${cancelOp.service_name ?? BILL_KIND[cancelOp.kind]} ${egp(cancelOp.amount)}) على الحساب ودرج الماكينات وحساب العميل داخل الوردية الحالية. لو الفاتورة مكررة، الإلغاء لهذه العملية فقط.`}
        run={async (reason) => {
          const { error } = await supabase.rpc('cancel_bill_operation', { p_id: cancelOp.id, p_reason: reason })
          if (error) throw opError(error)
        }}
        onClose={() => setCancelOp(null)} onDone={() => { refresh(); setCancelOp(null) }} />}
      {manage && <ServicesDialog services={services.data ?? []} loading={services.isLoading} onClose={() => setManage(false)} />}
    </div>
  )
}

function Done({ ops, onPrint, onHide }: { ops: BillOp[]; onPrint: () => void; onHide: () => void }) {
  const nos = ops.map((o) => o.op_no).sort()
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-sm">
      <span>تم تسجيل {ops.length > 1 ? `${ops.length} عمليات` : 'العملية'} <bdi className="font-semibold">{ops.length > 1 ? `${nos[0]} - ${nos[nos.length - 1]}` : nos[0]}</bdi>.</span>
      <span className="flex gap-2"><Button small onClick={onPrint}>طباعة إيصال</Button><Button small onClick={onHide}>إخفاء</Button></span>
    </div>
  )
}

const accOpt = (a: MoneyAccount) => <option key={a.id} value={a.id}>{a.name} ({ACCOUNT_KIND[a.kind]}) · {egp(a.balance)}</option>

function BillForm({
  accounts, services, servicesState, customers, customersLoading, onDone, onPrint,
}: {
  accounts: MoneyAccount[]
  services: BillService[]
  servicesState: 'loading' | 'error' | 'ok'
  customers: Customer[]
  customersLoading: boolean
  onDone: () => void
  onPrint: (ops: BillOp[]) => void
}) {
  const [serviceId, setServiceId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [f, setF] = useState({ amount: '', commission: '', reference: '', count: '1' })
  const [pay, setPay] = useState<'cash' | 'credit'>('cash')
  const [custId, setCustId] = useState<string | null>(null)
  const [idem, setIdem] = useState(() => newKey())
  const [last, setLast] = useState<BillOp[] | null>(null)

  const service = services.find((s) => s.id === serviceId)
  const account = accounts.find((x) => x.id === accountId)
  const a = softAmount(f.amount), c = softAmount(f.commission)
  const n = /^\d{1,2}$/.test(f.count.trim()) ? Number(f.count) : 0
  const countOk = n >= 1 && n <= 20
  const total = (a + c) * (countOk ? n : 1)
  const cost = a * (countOk ? n : 1)
  const short = !!account && a > 0 && toMinor(account.balance) - cost < toMinor(account.min_balance)

  const save = useMutation({
    mutationFn: async () => {
      if (!service) throw new Error('اختر الخدمة أولًا.')
      if (!account) throw new Error('اختر الحساب الذي ستدفع منه.')
      const amount = parseAmount(f.amount)
      const commission = parseAmount(f.commission, true)
      if (!countOk) throw new Error('عدد التكرار لازم يكون من 1 إلى 20.')
      if (pay === 'credit' && !custId) throw new Error('الدفع الآجل يحتاج عميلًا مسجلًا. اختر العميل أولًا.')
      const { data, error } = await supabase.rpc('pay_bill', {
        p_account: account.id, p_service: service.id, p_amount: toDb(amount), p_commission: toDb(commission), p_pay: pay,
        p_customer: pay === 'credit' ? custId : null, p_reference: f.reference.trim() || null, p_count: n, p_idem: idem,
      })
      if (error) throw opError(error)
      // The money is saved at this point: a failed read here must not look like a failed payment.
      const { data: ops } = await supabase.from('bill_operations').select('*').eq('group_id', data as string).order('op_no')
      return (ops ?? []) as BillOp[]
    },
    onSuccess: (ops) => {
      setLast(ops.length ? ops : null)
      setF({ amount: '', commission: service ? String(service.default_commission) : '', reference: '', count: '1' })
      setCustId(null); setPay('cash'); setIdem(newKey()); onDone()
    },
  })

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const pick = (s: BillService) => { setServiceId(s.id); setF((x) => ({ ...x, commission: String(s.default_commission) })) }

  return (
    <Card className="p-4 sm:p-5">
      {last && <Done ops={last} onPrint={() => onPrint(last)} onHide={() => setLast(null)} />}
      {save.isSuccess && !last && <p role="status" className="mb-3 rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-sm">تم تسجيل العملية. تجدها في السجل بالأسفل.</p>}
      <div className="mb-3"><ErrorText error={save.error} /></div>

      <p className="mb-1.5 text-xs font-medium text-muted">الخدمة</p>
      {servicesState === 'loading' && <div className="skeleton mb-3 h-9 w-full" />}
      {servicesState === 'error' && <p role="alert" className="mb-3 text-sm text-danger">تعذّر تحميل الخدمات. حدّث الصفحة.</p>}
      {servicesState === 'ok' && services.length === 0 && <p className="mb-3 text-sm text-muted">لا توجد خدمات مفعّلة. المالك أو المدير يضيفها من «إدارة الخدمات».</p>}
      <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="الخدمة">
        {services.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={serviceId === s.id} onClick={() => pick(s)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition active:scale-[0.97] ${serviceId === s.id ? 'border-accent btn-gel' : 'border-line bg-surface hover:bg-bg'}`}>
            {s.name}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="الدفع من حساب" hint={account ? `الرصيد الآن ${egp(account.balance)}` : 'ماكينة الدفع أو المحفظة التي ستسدد منها'}>
          <select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">اختر الحساب</option>{accounts.map(accOpt)}
          </select>
        </Field>
        <Field label="قيمة الفاتورة (جنيه)"><input className={inputCls} dir="ltr" inputMode="decimal" placeholder="0.00" value={f.amount} onChange={set('amount')} /></Field>
        <Field label="العمولة (جنيه)" hint="تتعبأ تلقائيًا من الخدمة ويمكن تعديلها"><input className={inputCls} dir="ltr" inputMode="decimal" placeholder="0.00" value={f.commission} onChange={set('commission')} /></Field>
        <Field label="طريقة الدفع">
          <select className={inputCls} value={pay} onChange={(e) => setPay(e.target.value as 'cash' | 'credit')}>
            <option value="cash">نقدي (العميل يدفع الآن)</option><option value="credit">آجل (على حساب العميل)</option>
          </select>
        </Field>
        <Field label="الرقم المرجعي (اختياري)" hint="رقم العداد أو الهاتف أو رقم العملية على الماكينة"><input className={inputCls} dir="ltr" maxLength={60} value={f.reference} onChange={set('reference')} /></Field>
        <Field label="عدد المرات" hint="من 1 إلى 20 (مثال: 5 كروت شحن بنفس القيمة)">
          <input className={inputCls} dir="ltr" type="number" inputMode="numeric" min={1} max={20} step={1} value={f.count} onChange={set('count')} />
        </Field>
        {pay === 'credit' && <CustomerPicker customers={customers} loading={customersLoading} value={custId} onChange={setCustId} required />}
      </div>

      <div className="mt-3 rounded-xl border border-info/30 bg-info/10 px-3 py-2.5 text-sm" aria-live="polite">
        {a > 0 && countOk ? <>
          <p>
            يُخصم {formatEGP(cost)} من {account ? <span dir="auto">{account.name}</span> : 'الحساب'}،{' '}
            {pay === 'cash' ? `والعميل يدفع ${formatEGP(total)} نقدًا تدخل درج الماكينات.` : `ويتسجل على العميل دين ${formatEGP(total)}.`}{' '}
            عمولتنا {formatEGP(c * n)}.
          </p>
          <p className="mt-1 font-semibold">الإجمالي: {n > 1 && <span className="font-normal text-muted">{n} × {formatEGP(a + c)} = </span>}{formatEGP(total)}</p>
        </> : <p>{countOk ? 'اكتب قيمة الفاتورة ليظهر الإجمالي قبل التأكيد.' : 'عدد المرات لازم يكون من 1 إلى 20.'}</p>}
      </div>
      {short && <p role="alert" className="mt-2 text-sm text-warn">رصيد الحساب لا يكفي لهذه العملية.</p>}

      <div className="mt-4 flex justify-end">
        <Button variant="primary" disabled={save.isPending || !service || !account || a <= 0 || !countOk} onClick={() => save.mutate()}>
          {save.isPending ? 'جارٍ التسجيل…' : n > 1 ? `دفع ${n} مرات` : 'دفع الفاتورة'}
        </Button>
      </div>
    </Card>
  )
}

function MachineForm({ machines, drawerCash, onDone, onPrint }: { machines: MoneyAccount[]; drawerCash: number | string | null; onDone: () => void; onPrint: (ops: BillOp[]) => void }) {
  const [accountId, setAccountId] = useState('')
  const [f, setF] = useState({ amount: '', commission: '', reference: '' })
  const [idem, setIdem] = useState(() => newKey())
  const [last, setLast] = useState<BillOp[] | null>(null)

  const machine = machines.find((m) => m.id === accountId) ?? (machines.length === 1 ? machines[0] : undefined)
  const a = softAmount(f.amount), c = softAmount(f.commission)
  const short = a > 0 && drawerCash !== null && toMinor(drawerCash) < a

  const save = useMutation({
    mutationFn: async () => {
      if (!machine) throw new Error('اختر الماكينة.')
      const amount = parseAmount(f.amount)
      const commission = parseAmount(f.commission, true)
      const { data, error } = await supabase.rpc('machine_operation', {
        p_account: machine.id, p_amount: toDb(amount), p_commission: toDb(commission), p_reference: f.reference.trim() || null, p_idem: idem,
      })
      if (error) throw opError(error)
      const { data: ops } = await supabase.from('bill_operations').select('*').eq('id', data as string)
      return (ops ?? []) as BillOp[]
    },
    onSuccess: (ops) => { setLast(ops.length ? ops : null); setF({ amount: '', commission: '', reference: '' }); setIdem(newKey()); onDone() },
  })

  if (machines.length === 0) return (
    <Card className="p-6 text-center text-sm text-muted">لا توجد ماكينة دفع نشطة. أضف ماكينة من صفحة «الأرصدة والحسابات» أولًا.</Card>
  )
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  return (
    <Card className="p-4 sm:p-5">
      {last && <Done ops={last} onPrint={() => onPrint(last)} onHide={() => setLast(null)} />}
      {save.isSuccess && !last && <p role="status" className="mb-3 rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-sm">تم تسجيل العملية. تجدها في السجل بالأسفل.</p>}
      <div className="mb-3"><ErrorText error={save.error} /></div>
      <p className="mb-3 text-sm text-muted">العميل يمرّر بطاقته على الماكينة وياخد المبلغ نقدًا من درج الماكينات.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الماكينة" hint={machine ? `الرصيد الآن ${egp(machine.balance)}` : undefined}>
          <select className={inputCls} value={machine?.id ?? ''} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">اختر الماكينة</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.name} · {egp(m.balance)}</option>)}
          </select>
        </Field>
        <Field label="المبلغ المسلَّم للعميل (جنيه)"><input className={inputCls} dir="ltr" inputMode="decimal" placeholder="0.00" value={f.amount} onChange={set('amount')} /></Field>
        <Field label="العمولة (جنيه)" hint="تُخصم من بطاقة العميل فوق المبلغ"><input className={inputCls} dir="ltr" inputMode="decimal" placeholder="0.00" value={f.commission} onChange={set('commission')} /></Field>
        <Field label="رقم العملية على الماكينة (اختياري)"><input className={inputCls} dir="ltr" maxLength={60} value={f.reference} onChange={set('reference')} /></Field>
      </div>

      <div className="mt-3 rounded-xl border border-info/30 bg-info/10 px-3 py-2.5 text-sm" aria-live="polite">
        {a > 0
          ? <p>اسحب من بطاقة العميل {formatEGP(a + c)} على الماكينة وسلّمه {formatEGP(a)} نقدًا. رصيد الماكينة يزيد {formatEGP(a + c)}، درج الماكينات ينقص {formatEGP(a)}، وعمولتنا {formatEGP(c)}.</p>
          : <p>اكتب المبلغ لتظهر نتيجة العملية قبل التأكيد.{drawerCash !== null && <> نقدية درج الماكينات الآن {egp(drawerCash)}.</>}</p>}
      </div>
      {short && <p role="alert" className="mt-2 text-sm text-warn">النقدية في درج الماكينات لا تكفي لتسليم العميل.</p>}

      <div className="mt-4 flex justify-end">
        <Button variant="primary" disabled={save.isPending || !machine || a <= 0} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ التسجيل…' : 'تسجيل السحب'}</Button>
      </div>
    </Card>
  )
}

// ---------- services management (owner / manager) ----------
const svcError = (e: { message?: string; code?: string }) =>
  e.code === '23505' ? new Error('توجد خدمة بنفس الاسم.') : e.code === '23514' ? new Error('اسم الخدمة من حرفين إلى 60 حرفًا، والعمولة لا تكون سالبة.') : opError(e)

function ServicesDialog({ services, loading, onClose }: { services: BillService[]; loading: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [commission, setCommission] = useState('')
  const reload = () => void qc.invalidateQueries({ queryKey: ['bill-services'] })
  const add = useMutation({
    mutationFn: async () => {
      const n = name.trim()
      if (n.length < 2 || n.length > 60) throw new Error('اكتب اسم الخدمة (من حرفين إلى 60 حرفًا).')
      const com = parseAmount(commission, true)
      const order = services.reduce((m, s) => Math.max(m, s.sort_order), 0) + 1
      const { error } = await supabase.from('bill_services').insert({ name: n, default_commission: toDb(com), sort_order: order })
      if (error) throw svcError(error)
    },
    onSuccess: () => { setName(''); setCommission(''); reload() },
  })
  return (
    <Modal open onClose={onClose} title="إدارة الخدمات" footer={<Button onClick={onClose}>تم</Button>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">الخدمات تظهر كأزرار سريعة في شاشة الدفع. الخدمة الموقوفة تختفي من الأزرار وتبقى عملياتها القديمة في السجل.</p>
        <div className="rounded-xl border border-line p-3">
          <p className="mb-2 text-sm font-semibold">خدمة جديدة</p>
          <ErrorText error={add.error} />
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Field label="الاسم" className="min-w-40 flex-1"><input className={inputCls} dir="auto" maxLength={60} placeholder="مثال: فاتورة تليفون" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="العمولة المعتادة" className="w-28"><input className={inputCls} dir="ltr" inputMode="decimal" placeholder="0.00" value={commission} onChange={(e) => setCommission(e.target.value)} /></Field>
            <Button variant="primary" disabled={add.isPending || !name.trim()} onClick={() => add.mutate()}>إضافة</Button>
          </div>
        </div>
        {loading && <div className="skeleton h-24 w-full" />}
        {!loading && services.length === 0 && <p className="text-center text-sm text-muted">لا توجد خدمات بعد.</p>}
        <ul className="space-y-2">
          {services.map((s) => <ServiceRow key={s.id} service={s} onSaved={reload} />)}
        </ul>
      </div>
    </Modal>
  )
}

function ServiceRow({ service, onSaved }: { service: BillService; onSaved: () => void }) {
  const [name, setName] = useState(service.name)
  const [commission, setCommission] = useState(String(service.default_commission))
  const dirty = name.trim() !== service.name || softAmount(commission) !== toMinor(service.default_commission)
  const save = useMutation({
    mutationFn: async (patch: { is_active: boolean } | null) => {
      let body: Partial<BillService>
      if (patch) body = patch
      else {
        const n = name.trim()
        if (n.length < 2 || n.length > 60) throw new Error('اكتب اسم الخدمة (من حرفين إلى 60 حرفًا).')
        body = { name: n, default_commission: toDb(parseAmount(commission, true)) }
      }
      const { error } = await supabase.from('bill_services').update(body).eq('id', service.id)
      if (error) throw svcError(error)
    },
    onSuccess: onSaved,
  })
  return (
    <li className={`rounded-xl border border-line p-2.5 ${service.is_active ? '' : 'opacity-70'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="اسم الخدمة" className={`${inputCls} min-w-36 flex-1`} dir="auto" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label="العمولة المعتادة" className={`${inputCls} !w-24`} dir="ltr" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} />
        <Button small variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(null)}>حفظ</Button>
        <Button small variant={service.is_active ? 'danger' : 'ghost'} disabled={save.isPending} onClick={() => save.mutate({ is_active: !service.is_active })}>
          {service.is_active ? 'إيقاف' : 'تفعيل'}
        </Button>
        {!service.is_active && <Chip tone="warn">موقوفة</Chip>}
      </div>
      {save.error && <div className="mt-2"><ErrorText error={save.error} /></div>}
    </li>
  )
}
