import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import ApproverPin from '../components/ApproverPin'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { CancelDialog, CustomerPicker, Kpi, NoShiftHint, RangeFilter } from '../components/WalletBits'
import { useAccounts, type MoneyAccount } from '../lib/accounts'
import { useCustomers, type Customer } from '../lib/customers'
import { useOpenSession } from '../lib/data'
import { newKey, useDrawerBalances } from '../lib/drawers'
import { formatEGP, toMinor } from '../lib/money'
import { downloadCsv } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { cairoBusinessDate, formatCairo } from '../lib/time'
import {
  egp, explainWallet, isCreditMode, needsPin, opError, parseAmount, printWalletReceipt, rangeOf, softAmount, STATUS_TONE, toDb,
  useWalletOps, walletEffect, WALLET_MODE, WALLET_MODE_SHORT, WALLET_STATUS, type RangePreset, type WalletMode, type WalletOp, type WalletStatus,
} from '../lib/walletOps'

const PHONE_RE = /^\+?[0-9]{7,15}$/
const EMPTY = { amount: '', commission: '', phone: '', note: '' }

export default function WalletOps() {
  const { hasRole } = useAuth()
  const boss = hasRole('owner', 'manager')
  const canOperate = hasRole('owner', 'manager', 'cashier')
  const qc = useQueryClient()
  const session = useOpenSession()
  const accounts = useAccounts()
  const customers = useCustomers()
  const drawers = useDrawerBalances()

  const today = cairoBusinessDate()
  const [preset, setPreset] = useState<RangePreset>('today')
  const [cFrom, setCFrom] = useState(today)
  const [cTo, setCTo] = useState(today)
  const range = rangeOf(preset, cFrom, cTo)
  const log = useWalletOps(range.from, range.to)
  const todayOps = useWalletOps(today, today)

  const [modeF, setModeF] = useState<'all' | WalletMode>('all')
  const [statusF, setStatusF] = useState<'all' | WalletStatus>('all')
  const [search, setSearch] = useState('')
  const [cancelOp, setCancelOp] = useState<WalletOp | null>(null)
  const [settleOp, setSettleOp] = useState<WalletOp | null>(null)

  const accName = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a.name])), [accounts.data])
  const custById = useMemo(() => new Map((customers.data ?? []).map((c) => [c.id, c])), [customers.data])
  const nameOfAcc = (id: string) => accName.get(id) ?? 'محفظة'
  const nameOfCust = (id: string | null) => (id ? custById.get(id)?.name ?? null : null)

  const refresh = () => { ['wallet-ops', 'accounts', 'drawers', 'customers', 'cash'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] })) }
  const print = (op: WalletOp) => printWalletReceipt(op, nameOfAcc(op.account_id), nameOfCust(op.customer_id))

  const kpi = useMemo(() => {
    const live = (todayOps.data ?? []).filter((o) => o.status !== 'cancelled')
    const sum = (rows: WalletOp[], f: (o: WalletOp) => number | string) => rows.reduce((s, o) => s + toMinor(f(o)), 0)
    return {
      count: live.length,
      sent: sum(live.filter((o) => o.mode === 'send' || o.mode === 'send_credit'), (o) => o.amount),
      received: sum(live.filter((o) => o.mode === 'receive' || o.mode === 'receive_credit'), (o) => o.amount),
      commission: sum(live, (o) => o.commission),
      pending: live.filter((o) => o.status === 'pending').length,
    }
  }, [todayOps.data])

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (log.data ?? []).filter((o) => {
      if (modeF !== 'all' && o.mode !== modeF) return false
      if (statusF !== 'all' && o.status !== statusF) return false
      if (!s) return true
      const c = o.customer_id ? custById.get(o.customer_id) : undefined
      return [o.op_no, o.party_phone, o.note, accName.get(o.account_id), c?.name, c?.phone].some((v) => (v ?? '').toLowerCase().includes(s))
    })
  }, [log.data, modeF, statusF, search, custById, accName])

  const exportCsv = () => downloadCsv(`wallet-operations-${range.from}_${range.to}.csv`,
    ['الرقم', 'التاريخ', 'العملية', 'المحفظة', 'المبلغ', 'العمولة', 'العميل', 'رقم الطرف الآخر', 'الحالة', 'ملاحظة', 'سبب الإلغاء'],
    rows.map((o) => [o.op_no, formatCairo(o.created_at), WALLET_MODE_SHORT[o.mode], nameOfAcc(o.account_id), o.amount, o.commission,
      nameOfCust(o.customer_id), o.party_phone, WALLET_STATUS[o.status], o.note, o.cancel_reason]))

  return (
    <div>
      <PageHeader title="إرسال واستقبال" subtitle="تحويلات المحافظ الإلكترونية للعملاء: نقدي أو آجل، مع العمولة وحدود كل محفظة." />

      {session.isSuccess && !session.data && <NoShiftHint />}

      <div className="stagger mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="عمليات اليوم" value={String(kpi.count)} />
        <Kpi label="إجمالي المُرسَل اليوم" value={formatEGP(kpi.sent)} />
        <Kpi label="إجمالي المُستقبَل اليوم" value={formatEGP(kpi.received)} />
        <Kpi label="عمولة اليوم" value={formatEGP(kpi.commission)} tone="ok" />
        <Kpi label="بانتظار التحويل" value={String(kpi.pending)} tone={kpi.pending ? 'warn' : undefined} />
      </div>

      {canOperate && <OpForm
        wallets={(accounts.data ?? []).filter((a) => a.kind === 'wallet' && a.is_active)}
        accountsState={accounts.isLoading ? 'loading' : accounts.isError ? 'error' : 'ok'}
        customers={customers.data ?? []} customersLoading={customers.isLoading}
        drawerCash={drawers.data?.find((d) => d.code === 'wallets')?.balance ?? null}
        onDone={refresh} onPrint={print} />}

      <div className="mb-2 mt-6 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-bold">سجل العمليات</h2>
        <Button disabled={!rows.length} onClick={exportCsv}>تصدير CSV</Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <RangeFilter preset={preset} from={cFrom} to={cTo} onPreset={setPreset} onFrom={setCFrom} onTo={setCTo} />
        <select aria-label="نوع العملية" className={`${inputCls} !w-36`} value={modeF} onChange={(e) => setModeF(e.target.value as typeof modeF)}>
          <option value="all">كل الأنواع</option>
          {Object.entries(WALLET_MODE_SHORT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="الحالة" className={`${inputCls} !w-40`} value={statusF} onChange={(e) => setStatusF(e.target.value as typeof statusF)}>
          <option value="all">كل الحالات</option>
          {Object.entries(WALLET_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input aria-label="بحث" className={`${inputCls} min-w-40 flex-1`} dir="auto" placeholder="بحث برقم العملية أو الهاتف أو العميل" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {range.from > range.to && <Card className="p-6 text-center text-sm text-warn">تاريخ البداية بعد تاريخ النهاية. صحّح الفترة.</Card>}
      {log.isLoading && <State kind="loading" />}
      {log.isError && <State kind="error" text="تعذّر تحميل سجل العمليات. تأكد من تطبيق آخر تحديث لقاعدة البيانات." action={<Button onClick={() => void log.refetch()}>حاول تاني</Button>} />}
      {log.isSuccess && rows.length === 0 && <Card className="p-6 text-center text-sm text-muted">
        {log.data.length ? 'لا توجد عمليات مطابقة للبحث أو الفلاتر.' : 'لا توجد عمليات في هذه الفترة.'}
      </Card>}
      {rows.length > 0 && <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b border-line text-muted">{['الرقم', 'التاريخ', 'العملية', 'المحفظة', 'المبلغ', 'العمولة', 'العميل / الرقم', 'الحالة', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h || <span className="sr-only">إجراءات</span>}</th>)}</tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id} className={`border-b border-line last:border-0 ${o.status === 'cancelled' ? 'opacity-60' : ''}`}>
              <td className="whitespace-nowrap p-3 font-medium"><bdi>{o.op_no}</bdi></td>
              <td className="whitespace-nowrap p-3">{formatCairo(o.created_at)}</td>
              <td className="p-3"><Chip tone={isCreditMode(o.mode) ? 'warn' : 'info'}>{WALLET_MODE_SHORT[o.mode]}</Chip></td>
              <td className="p-3" dir="auto">{nameOfAcc(o.account_id)}</td>
              <td className="whitespace-nowrap p-3 font-semibold">{egp(o.amount)}</td>
              <td className="whitespace-nowrap p-3 text-ok">{egp(o.commission)}</td>
              <td className="p-3">
                {nameOfCust(o.customer_id) && <span className="block" dir="auto">{nameOfCust(o.customer_id)}</span>}
                {o.party_phone && <bdi className="text-xs text-muted">{o.party_phone}</bdi>}
                {!o.customer_id && !o.party_phone && <span className="text-muted">-</span>}
              </td>
              <td className="p-3">
                <Chip tone={STATUS_TONE[o.status]}>{WALLET_STATUS[o.status]}</Chip>
                {o.cancel_reason && <span className="mt-1 block max-w-44 text-xs text-muted" dir="auto">{o.cancel_reason}</span>}
              </td>
              <td className="p-3">
                <div className="flex flex-wrap justify-end gap-1.5">
                  {canOperate && o.status === 'pending' && <Button small variant="primary" onClick={() => setSettleOp(o)}>تم استلام التحويل</Button>}
                  <Button small onClick={() => print(o)}>طباعة</Button>
                  {boss && o.status !== 'cancelled' && <Button small variant="danger" onClick={() => setCancelOp(o)}>إلغاء</Button>}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Card>}

      {settleOp && <SettleDialog op={settleOp} walletName={nameOfAcc(settleOp.account_id)} customerName={nameOfCust(settleOp.customer_id)}
        onClose={() => setSettleOp(null)} onDone={() => { refresh(); setSettleOp(null) }} />}
      {cancelOp && <CancelDialog title={`إلغاء العملية ${cancelOp.op_no}`}
        text={`سيتم عكس كل أثر العملية (${WALLET_MODE_SHORT[cancelOp.mode]} ${egp(cancelOp.amount)}) على المحفظة ودرج المحافظ وحساب العميل داخل الوردية الحالية. تأكد أن التحويل نفسه اترجّع على المحفظة الفعلية.`}
        run={async (reason) => {
          const { error } = await supabase.rpc('cancel_wallet_operation', { p_id: cancelOp.id, p_reason: reason })
          if (error) throw opError(error)
        }}
        onClose={() => setCancelOp(null)} onDone={() => { refresh(); setCancelOp(null) }} />}
    </div>
  )
}

function OpForm({
  wallets, accountsState, customers, customersLoading, drawerCash, onDone, onPrint,
}: {
  wallets: MoneyAccount[]
  accountsState: 'loading' | 'error' | 'ok'
  customers: Customer[]
  customersLoading: boolean
  drawerCash: number | string | null
  onDone: () => void
  onPrint: (op: WalletOp) => void
}) {
  const [walletId, setWalletId] = useState('')
  const [mode, setMode] = useState<WalletMode>('receive')
  const [f, setF] = useState(EMPTY)
  const [custId, setCustId] = useState<string | null>(null)
  const [idem, setIdem] = useState(() => newKey())
  const [pin, setPin] = useState(false)
  const [last, setLast] = useState<WalletOp | null>(null)

  const wallet = wallets.find((w) => w.id === walletId) ?? (wallets.length === 1 ? wallets[0] : undefined)
  const credit = isCreditMode(mode)
  const a = softAmount(f.amount), c = softAmount(f.commission)
  const eff = walletEffect(mode, a, c)

  // Live warnings: the database decides in the end, this only saves a wasted click.
  const warnings: string[] = []
  if (wallet && a > 0) {
    const bal = toMinor(wallet.balance)
    if (eff.wallet < 0 && bal + eff.wallet < toMinor(wallet.min_balance)) warnings.push('رصيد المحفظة لا يكفي لهذا الإرسال.')
    if (eff.wallet !== 0) {
      if (wallet.daily_limit !== null && toMinor(wallet.used_today) + a > toMinor(wallet.daily_limit)) warnings.push('المبلغ يتجاوز المتبقي من الحد اليومي للمحفظة.')
      if (wallet.monthly_limit !== null && toMinor(wallet.used_month) + a > toMinor(wallet.monthly_limit)) warnings.push('المبلغ يتجاوز المتبقي من الحد الشهري للمحفظة.')
    }
    if (eff.drawer < 0 && drawerCash !== null && toMinor(drawerCash) + eff.drawer < 0) warnings.push('النقدية في درج المحافظ لا تكفي لتسليم العميل.')
    if ((mode === 'receive' || mode === 'receive_credit') && c >= a) warnings.push('العمولة لازم تكون أقل من المبلغ.')
  }

  const save = useMutation({
    mutationFn: async (token: string | null) => {
      if (!wallet) throw new Error('اختر المحفظة.')
      const amount = parseAmount(f.amount)
      const commission = parseAmount(f.commission, true)
      if ((mode === 'receive' || mode === 'receive_credit') && commission >= amount) throw new Error('العمولة لازم تكون أقل من المبلغ.')
      const phone = f.phone.replace(/[\s-]/g, '')
      if (phone && !PHONE_RE.test(phone)) throw new Error('رقم الهاتف غير صحيح (من 7 إلى 15 رقمًا).')
      if (credit && !custId) throw new Error('العملية الآجلة تحتاج عميلًا مسجلًا. اختر العميل أولًا.')
      const { data, error } = await supabase.rpc('process_wallet_operation', {
        p_account: wallet.id, p_mode: mode, p_amount: toDb(amount), p_commission: toDb(commission), p_customer: custId,
        p_party_phone: phone || null, p_note: f.note.trim() || null, p_idem: idem, p_override: token,
      })
      if (error) throw opError(error)
      return data as WalletOp
    },
    onSuccess: (op) => { setLast(op); setF(EMPTY); setCustId(null); setIdem(newKey()); onDone() },
    onError: (e) => { if (needsPin(e)) setPin(true) },
  })

  if (accountsState === 'loading') return <State kind="loading" />
  if (accountsState === 'error') return <Card className="p-6 text-center text-sm text-danger">تعذّر تحميل المحافظ. حدّث الصفحة.</Card>
  if (wallets.length === 0) return (
    <Card className="p-6 text-center text-sm text-muted">لا توجد محفظة إلكترونية نشطة. أضف محفظة وسجّل رصيدها من صفحة «الأرصدة والحسابات» أولًا.</Card>
  )

  const left = (limit: number | string | null, used: number | string) => (limit === null ? 'بدون حد' : formatEGP(Math.max(0, toMinor(limit) - toMinor(used))))
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="mb-3 text-lg font-bold">عملية جديدة</h2>
      {last && (
        <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-sm">
          <span>تم تسجيل العملية <bdi className="font-semibold">{last.op_no}</bdi> ({WALLET_MODE_SHORT[last.mode]} {egp(last.amount)}){last.status === 'pending' && ' وهي بانتظار وصول التحويل'}.</span>
          <span className="flex gap-2"><Button small onClick={() => onPrint(last)}>طباعة إيصال</Button><Button small onClick={() => setLast(null)}>إخفاء</Button></span>
        </div>
      )}
      <div className="mb-3">{!needsPin(save.error) && <ErrorText error={save.error} />}</div>

      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4" role="radiogroup" aria-label="نوع العملية">
        {(Object.keys(WALLET_MODE) as WalletMode[]).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
            className={`rounded-xl border px-3 py-2.5 text-start text-sm font-medium transition active:scale-[0.98] ${mode === m ? 'border-accent bg-accent/10 text-fg' : 'border-line bg-surface text-muted hover:bg-bg'}`}>
            {WALLET_MODE[m]}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="المحفظة">
          <select className={inputCls} value={wallet?.id ?? ''} onChange={(e) => setWalletId(e.target.value)}>
            <option value="">اختر المحفظة</option>
            {wallets.map((w) => <option key={w.id} value={w.id}>{w.name} · {egp(w.balance)}</option>)}
          </select>
        </Field>
        <Field label="مبلغ التحويل (جنيه)"><input className={inputCls} dir="ltr" inputMode="decimal" placeholder="0.00" value={f.amount} onChange={set('amount')} /></Field>
        <Field label="العمولة (جنيه)" hint="اتركها فارغة إذا لا توجد عمولة"><input className={inputCls} dir="ltr" inputMode="decimal" placeholder="0.00" value={f.commission} onChange={set('commission')} /></Field>
        <Field label="رقم الطرف الآخر (اختياري)"><input className={inputCls} dir="ltr" inputMode="tel" maxLength={20} placeholder="01xxxxxxxxx" value={f.phone} onChange={set('phone')} /></Field>
        <CustomerPicker customers={customers} loading={customersLoading} value={custId} onChange={setCustId} required={credit} />
        <Field label="ملاحظة (اختياري)"><input className={inputCls} dir="auto" maxLength={200} value={f.note} onChange={set('note')} /></Field>
      </div>

      {wallet && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-xl bg-bg/60 px-3 py-2 text-xs text-muted">
          <span>رصيد المحفظة: <b className="text-fg">{egp(wallet.balance)}</b></span>
          <span>المتبقي من حد اليوم: <b className="text-fg">{left(wallet.daily_limit, wallet.used_today)}</b></span>
          <span>المتبقي من حد الشهر: <b className="text-fg">{left(wallet.monthly_limit, wallet.used_month)}</b></span>
          {drawerCash !== null && <span>نقدية درج المحافظ: <b className="text-fg">{egp(drawerCash)}</b></span>}
        </div>
      )}

      <div className="mt-3 rounded-xl border border-info/30 bg-info/10 px-3 py-2.5 text-sm" aria-live="polite">
        <p>{a > 0 ? explainWallet(mode, a, c) : 'اكتب المبلغ لتظهر لك نتيجة العملية على المحفظة والدرج والعميل قبل التأكيد.'}</p>
        {a > 0 && <div className="mt-2 flex flex-wrap gap-2">
          <Delta label="المحفظة" v={eff.wallet} />
          <Delta label="درج المحافظ" v={eff.drawer} />
          {credit && <Delta label="دين العميل" v={eff.debt} debt />}
        </div>}
      </div>
      {warnings.map((w) => <p key={w} role="alert" className="mt-2 text-sm text-warn">{w}</p>)}

      <div className="mt-4 flex justify-end">
        <Button variant="primary" disabled={save.isPending || !wallet || a <= 0} onClick={() => save.mutate(null)}>
          {save.isPending ? 'جارٍ التسجيل…' : `تسجيل ${WALLET_MODE_SHORT[mode]}`}
        </Button>
      </div>

      <ApproverPin open={pin} onClose={() => setPin(false)} reason={`${WALLET_MODE_SHORT[mode]} ${f.amount} جنيه من ${wallet?.name ?? 'محفظة'}`}
        onToken={(t) => { setPin(false); save.mutate(t) }} />
    </Card>
  )
}

function Delta({ label, v, debt }: { label: string; v: number; debt?: boolean }) {
  if (v === 0) return <Chip>{label}: لا يتغير</Chip>
  const good = debt ? false : v > 0
  return <Chip tone={debt ? 'warn' : good ? 'ok' : 'danger'}>{label}: {v > 0 ? '+' : '−'} {formatEGP(Math.abs(v))}</Chip>
}

function SettleDialog({ op, walletName, customerName, onClose, onDone }: { op: WalletOp; walletName: string; customerName: string | null; onClose: () => void; onDone: () => void }) {
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('settle_wallet_operation', { p_id: op.id })
      if (error) throw opError(error)
    },
    onSuccess: onDone,
  })
  return (
    <Modal open onClose={onClose} title={`استلام تحويل ${op.op_no}`}
      footer={<><Button onClick={onClose}>رجوع</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ التسجيل…' : 'نعم، التحويل وصل'}</Button></>}>
      <div className="space-y-3 text-sm">
        <ErrorText error={save.error} />
        <p>تأكد أولًا أن مبلغ <b>{egp(op.amount)}</b> وصل فعلًا على محفظة <b dir="auto">{walletName}</b>.</p>
        <p className="text-muted">عند التأكيد: رصيد المحفظة يزيد {egp(op.amount)}{customerName && <>، ودين <span dir="auto">{customerName}</span> ينقص بنفس المبلغ</>}. المبلغ يُحسب من الحد اليومي والشهري للمحفظة.</p>
      </div>
    </Modal>
  )
}
