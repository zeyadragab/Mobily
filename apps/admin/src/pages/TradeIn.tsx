import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import ApproverPin from '../components/ApproverPin'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { CustomerPicker, Kpi, NoShiftHint } from '../components/WalletBits'
import { useAccounts } from '../lib/accounts'
import { useCustomers } from '../lib/customers'
import { useOpenSession } from '../lib/data'
import { newKey, useDrawerBalances } from '../lib/drawers'
import { money, TRADE_PAY, useTrackedVariants, useTradeIns, type TradeIn as TradeInRow } from '../lib/installments'
import { formatEGP, toMinor } from '../lib/money'
import { downloadCsv } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { cairoBusinessDate, formatCairo } from '../lib/time'

const m = (v: number | string) => formatEGP(toMinor(v))

/** Buying a used device from a person: it enters stock at the price paid, with the seller's details kept apart. */
export default function TradeIn() {
  const { hasRole } = useAuth()
  const boss = hasRole('owner', 'manager')
  const qc = useQueryClient()
  const session = useOpenSession()
  const list = useTradeIns()
  const [open, setOpen] = useState(false)
  const [cancel, setCancel] = useState<TradeInRow | null>(null)
  const today = cairoBusinessDate()
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['trade-ins'] }), qc.invalidateQueries({ queryKey: ['customers'] }),
    qc.invalidateQueries({ queryKey: ['drawers'] }), qc.invalidateQueries({ queryKey: ['accounts'] }), qc.invalidateQueries({ queryKey: ['devices'] }),
  ])
  const active = (list.data ?? []).filter((t) => t.status === 'active')
  const todayRows = active.filter((t) => cairoBusinessDate(new Date(t.created_at)) === today)

  return (
    <div>
      <PageHeader title="المستعمل والتبديل" subtitle="شراء جهاز مستعمل من شخص: بيدخل المخزن بسعر الشراء، وبيانات البائع محفوظة بشكل منفصل."
        actions={<>
          <Button onClick={() => downloadCsv('trade-ins.csv', ['الرقم', 'التاريخ', 'الجهاز', 'السيريال', 'السعر', 'الدفع', 'البائع', 'الحالة'],
            (list.data ?? []).map((t) => [t.trade_no, t.created_at, t.variants?.products?.name, t.serial, t.price, TRADE_PAY[t.pay], t.seller_name, t.status]))}>تصدير CSV</Button>
          <Button variant="primary" onClick={() => setOpen(true)}>+ شراء جهاز مستعمل</Button>
        </>} />
      {session.isSuccess && !session.data && <NoShiftHint />}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="مشتريات اليوم" value={String(todayRows.length)} />
        <Kpi label="قيمة مشتريات اليوم" value={formatEGP(todayRows.reduce((s, t) => s + toMinor(t.price), 0))} />
        <Kpi label="كل المشتريات النشطة" value={String(active.length)} />
        <Kpi label="ملغية" value={String((list.data ?? []).length - active.length)} tone="warn" />
      </div>

      {list.isLoading && <State kind="loading" />}
      {list.isError && <State kind="error" text="تعذّر تحميل المشتريات." action={<Button onClick={() => void list.refetch()}>حاول تاني</Button>} />}
      {list.isSuccess && list.data.length === 0 && <State kind="empty" title="لا توجد مشتريات مستعمل بعد" />}
      {!!list.data?.length && <Card className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
        <thead><tr className="border-b border-line text-muted">
          {['الرقم', 'التاريخ', 'الجهاز', 'السيريال', 'السعر', 'الدفع', 'البائع', 'الحالة', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h}</th>)}
        </tr></thead>
        <tbody>{list.data.map((t) => <tr key={t.id} className="border-b border-line last:border-0">
          <td className="p-3"><bdi>{t.trade_no}</bdi></td><td className="p-3">{formatCairo(t.created_at)}</td>
          <td className="p-3" dir="auto">{t.variants?.products?.name}<p className="text-xs text-muted"><bdi>{t.variants?.sku}</bdi></p></td>
          <td className="p-3"><bdi>{t.serial}</bdi></td>
          <td className="p-3">{m(t.price)}{t.expected_price != null && <p className="text-xs text-muted">المتوقع {m(t.expected_price)}</p>}</td>
          <td className="p-3">{TRADE_PAY[t.pay]}</td>
          <td className="p-3" dir="auto">{t.seller_name}{t.seller_phone && <p className="text-xs text-muted"><bdi>{t.seller_phone}</bdi></p>}</td>
          <td className="p-3">{t.status === 'cancelled' ? <Chip tone="danger">ملغي</Chip> : <Chip tone="ok">في المخزن</Chip>}{t.cancel_reason && <p className="text-xs text-muted" dir="auto">{t.cancel_reason}</p>}</td>
          <td className="p-3">{boss && t.status === 'active' && <Button small variant="danger" onClick={() => setCancel(t)}>إلغاء</Button>}</td>
        </tr>)}</tbody>
      </table></Card>}

      {open && <BuyDialog onClose={() => setOpen(false)} onDone={async () => { setOpen(false); await refresh() }} />}
      {cancel && <CancelTrade row={cancel} onClose={() => setCancel(null)} onDone={async () => { setCancel(null); await refresh() }} />}
    </div>
  )
}

function BuyDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { hasRole } = useAuth()
  const boss = hasRole('owner', 'manager')
  const variants = useTrackedVariants()
  const customers = useCustomers()
  const drawers = useDrawerBalances()
  const accounts = useAccounts()
  const [f, setF] = useState({
    variant: '', serial: '', price: '', expected: '', pay: 'cash' as keyof typeof TRADE_PAY, drawer: 'products', account: '',
    name: '', phone: '', nid: '', address: '', condition: '',
  })
  const [cust, setCust] = useState<string | null>(null)
  const [key] = useState(newKey)
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }))
  const save = useMutation({
    mutationFn: async () => {
      if (!f.variant) throw new Error('اختر نوع الجهاز.')
      if (f.pay === 'account' && !f.account) throw new Error('اختر المحفظة أو الماكينة اللي هتدفع منها.')
      if (f.pay === 'credit' && !cust) throw new Error('اختر العميل اللي هيتخصم من دينه.')
      const { error } = await supabase.rpc('create_trade_in', {
        p_variant: f.variant, p_serial: f.serial, p_price: money(f.price), p_pay: f.pay,
        p_drawer: f.pay === 'cash' ? f.drawer : null, p_account: f.pay === 'account' ? f.account : null, p_customer: f.pay === 'credit' ? cust : null,
        p_seller_name: f.name, p_seller_phone: f.phone || null, p_seller_national_id: f.nid, p_seller_address: f.address || null,
        p_condition: f.condition || null, p_expected: f.expected.trim() ? money(f.expected, { zero: true }) : null, p_idem: key,
      })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  return (
    <Modal open wide onClose={onClose} title="شراء جهاز مستعمل"
      footer={<><Button onClick={onClose}>رجوع</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ التسجيل…' : 'تأكيد الشراء'}</Button></>}>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorText error={save.error} /></div>
        <Field label="نوع الجهاز" className="sm:col-span-2" hint={variants.isSuccess && !variants.data.length ? 'مفيش منتج متفعّل عليه التتبع بالسيريال. فعّله من صفحة المنتجات.' : undefined}>
          <select className={inputCls} value={f.variant} onChange={(e) => set('variant', e.target.value)}>
            <option value="">{variants.isLoading ? 'جارٍ التحميل…' : 'اختر'}</option>
            {(variants.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.products?.name} · {v.sku}{v.color ? ` · ${v.color}` : ''}{v.storage ? ` · ${v.storage}` : ''}</option>)}
          </select>
        </Field>
        <Field label="السيريال / IMEI"><input className={inputCls} dir="ltr" value={f.serial} onChange={(e) => set('serial', e.target.value)} /></Field>
        <Field label="سعر الشراء" hint={boss ? undefined : 'الكاشير بيشتري تحت 5,000 جنيه. فوق كده محتاج مدير.'}>
          <input className={inputCls} dir="ltr" inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} />
        </Field>
        <Field label="السعر المتوقع (اختياري)"><input className={inputCls} dir="ltr" inputMode="decimal" value={f.expected} onChange={(e) => set('expected', e.target.value)} /></Field>
        <Field label="طريقة الدفع للبائع">
          <select className={inputCls} value={f.pay} onChange={(e) => set('pay', e.target.value)}>
            {Object.entries(TRADE_PAY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {f.pay === 'cash' && <Field label="الدرج اللي بنطلّع منه الفلوس">
          <select className={inputCls} value={f.drawer} onChange={(e) => set('drawer', e.target.value)}>
            {(drawers.data ?? []).filter((d) => d.code !== 'safe' || boss).map((d) => <option key={d.id} value={d.code}>{d.name} · {formatEGP(toMinor(d.balance))}</option>)}
          </select>
        </Field>}
        {f.pay === 'account' && <Field label="الحساب">
          <select className={inputCls} value={f.account} onChange={(e) => set('account', e.target.value)}>
            <option value="">اختر الحساب</option>
            {(accounts.data ?? []).filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name} · {formatEGP(toMinor(a.balance))}</option>)}
          </select>
        </Field>}
        {f.pay === 'credit' && <div className="sm:col-span-2"><CustomerPicker customers={customers.data ?? []} loading={customers.isLoading} value={cust} onChange={setCust} required /></div>}

        <h3 className="mt-2 font-semibold sm:col-span-2">بيانات البائع</h3>
        <Field label="الاسم"><input className={inputCls} dir="auto" maxLength={120} value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="الموبايل"><input className={inputCls} dir="ltr" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="الرقم القومي (14 رقم)" hint="مطلوب لحماية المحل من الأجهزة المسروقة. بيتحفظ منفصل وما بيظهرش للكاشير."><input className={inputCls} dir="ltr" inputMode="numeric" maxLength={14} value={f.nid} onChange={(e) => set('nid', e.target.value)} /></Field>
        <Field label="العنوان (اختياري)"><input className={inputCls} dir="auto" maxLength={200} value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="حالة الجهاز (اختياري)" className="sm:col-span-2"><input className={inputCls} dir="auto" maxLength={300} value={f.condition} onChange={(e) => set('condition', e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

/** Owner cancels directly; a manager needs another approver's PIN (a one-time token). */
function CancelTrade({ row, onClose, onDone }: { row: TradeInRow; onClose: () => void; onDone: () => void }) {
  const { hasRole } = useAuth()
  const isOwner = hasRole('owner')
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState(false)
  const run = useMutation({
    mutationFn: async (token: string | null) => {
      const { error } = await supabase.rpc('cancel_trade_in', { p_id: row.id, p_reason: reason.trim(), p_override: token })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  return (
    <Modal open onClose={onClose} title={`إلغاء الشراء ${row.trade_no}`}
      footer={<><Button onClick={onClose}>رجوع</Button>
        <Button variant="danger" disabled={run.isPending || reason.trim().length < 3} onClick={() => (isOwner ? run.mutate(null) : setPin(true))}>
          {run.isPending ? 'جارٍ الإلغاء…' : 'تأكيد الإلغاء'}</Button></>}>
      <div className="space-y-3 text-sm">
        <ErrorText error={run.error} />
        <p className="text-muted">الجهاز بيخرج من المخزن والفلوس بترجع (للدرج أو الحساب أو دين العميل). ينفع بس لو الجهاز لسه في المخزن، ومحتاج وردية مفتوحة.
          {!isOwner && ' المدير محتاج موافقة المالك بالرقم السري.'}</p>
        <Field label="سبب الإلغاء (إلزامي)"><input className={inputCls} dir="auto" autoFocus maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <ApproverPin open={pin} onClose={() => setPin(false)} reason={`إلغاء شراء مستعمل ${row.trade_no}`} onToken={(t) => run.mutate(t)} />
    </Modal>
  )
}
