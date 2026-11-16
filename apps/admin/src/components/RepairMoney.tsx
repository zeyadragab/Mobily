import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { formatCairo } from '../lib/time'
import { newKey } from '../lib/drawers'
import { PAY_METHOD, PAYMENT_KIND, WARRANTY_CHOICES, type RepairDetail, type RepairPayment } from '../lib/repairs'
import { Button, Chip, ErrorText, Field, inputCls } from './ui'
import { AccountSelect } from './SourcePicker'
import ApproverPin from './ApproverPin'
import { CustomerPicker } from './WalletBits'
import { useCustomers } from '../lib/customers'

/** Money and hand-over for one repair: deposits, payments, refunds, and delivery with warranty. */
export default function RepairMoney({ order, onChanged }: { order: RepairDetail; onChanged: () => Promise<void> }) {
  const { hasRole } = useAuth()
  const canSee = hasRole('owner', 'manager', 'cashier', 'accountant')
  const canTake = hasRole('owner', 'manager', 'cashier')
  const canRefund = hasRole('owner', 'manager')
  const priced = !!order.quoted_at && toMinor(order.quote_total) > 0

  const payments = useQuery({
    queryKey: ['repair-payments', order.id],
    enabled: canSee,
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_payments')
        .select('id,order_id,kind,method,amount,note,created_at').eq('order_id', order.id).order('created_at', { ascending: false })
      if (error) throw error
      return data as RepairPayment[]
    },
  })
  const paid = (payments.data ?? []).reduce((s, p) => s + (p.kind === 'refund' ? -1 : 1) * toMinor(p.amount), 0)
  const quote = toMinor(order.quote_total)
  const onAccount = toMinor(order.credit_amount ?? 0)   // the rest that moved to the customer's account at delivery
  const remaining = quote - paid - onAccount
  const canSeeProfit = hasRole('owner', 'manager', 'accountant')
  const profit = useQuery({
    queryKey: ['repair-profit', order.id, order.revision],
    enabled: canSeeProfit && !!order.quoted_at,
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_profit').select('parts_cost,profit,realized').eq('order_id', order.id).single()
      if (error) throw error
      return data as { parts_cost: number | string | null; profit: number | string | null; realized: boolean }
    },
  })
  const isOwner = hasRole('owner')
  const canCancelDelivery = hasRole('owner', 'manager') && order.status === 'delivered'
  const customers = useCustomers(canTake && !order.customer_id)
  const [linkCust, setLinkCust] = useState<string | null>(null)
  const link = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('set_repair_customer', { p_order: order.id, p_customer: linkCust })
      if (error) throw error
    },
    onSuccess: async () => { setLinkCust(null); await onChanged() },
  })
  const [cancelReason, setCancelReason] = useState('')
  const [pinOpen, setPinOpen] = useState(false)
  const cancelDelivery = useMutation({
    mutationFn: async (token: string | null) => {
      const { error } = await supabase.rpc('cancel_delivered_repair', { p_order: order.id, p_reason: cancelReason.trim(), p_override: token })
      if (error) throw error
    },
    onSuccess: async () => { setCancelReason(''); setPinOpen(false); await Promise.all([payments.refetch(), onChanged()]) },
  })

  const [kind, setKind] = useState<'deposit' | 'payment'>('deposit')
  const [method, setMethod] = useState<keyof typeof PAY_METHOD>('cash')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [key, setKey] = useState(newKey())
  const [refund, setRefund] = useState(false)
  const [account, setAccount] = useState('')

  const pay = useMutation({
    mutationFn: async (k: 'deposit' | 'payment' | 'refund') => {
      let m = 0
      try { m = toMinor(amount) } catch { m = 0 }
      if (m <= 0) throw new Error('اكتب مبلغ صحيح.')
      const { error } = await supabase.rpc('record_repair_payment', {
        p_order: order.id, p_amount: Number(fromMinor(m)), p_method: method, p_kind: k, p_note: note.trim() || null, p_idem: key,
        p_account: method !== 'cash' && account ? account : null,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      setAmount(''); setNote(''); setRefund(false); setKey(newKey()); setAccount('')
      await Promise.all([payments.refetch(), onChanged()])
    },
  })

  const [warranty, setWarranty] = useState(30)
  const [handNote, setHandNote] = useState('')
  const [withBalance, setWithBalance] = useState(false)     // owner / manager: hand over with the rest unpaid and a written reason
  const [onCustomer, setOnCustomer] = useState(false)       // the rest goes on the registered customer's account
  const deliver = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('deliver_repair', {
        p_id: order.id, p_revision: order.revision, p_warranty_days: order.status === 'ready' ? warranty : 0,
        p_note: handNote.trim() || null, p_allow_balance: withBalance || onCustomer,
      })
      if (error) throw error
    },
    onSuccess: onChanged,
  })

  if (!canSee) return null
  const canDeliver = canTake && ['ready', 'cancelled', 'unrepairable'].includes(order.status)
  const needsBalanceOk = remaining > 0

  return (
    <section className="space-y-3 rounded-xl border border-line p-3 text-sm" aria-label="الدفع والتسليم">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">الدفع والتسليم</h3>
        {priced && (remaining === 0 ? <Chip tone="ok">مدفوع بالكامل</Chip> : <Chip tone="warn">متبقي {formatEGP(remaining)}</Chip>)}
        {order.warranty_until && <Chip tone="info">ضمان حتى {order.warranty_until}</Chip>}
        {onAccount > 0 && <Chip tone="warn">على حساب العميل {formatEGP(onAccount)}</Chip>}
        {order.customer_id && <Chip>مربوط بحساب عميل</Chip>}
      </div>

      {!priced && <p className="text-muted">لسه ما فيش سعر على الأمر. الدفع بيبدأ بعد التسعير.</p>}
      {priced && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-bg p-2"><p className="text-xs text-muted">الإجمالي</p><p className="font-bold">{formatEGP(quote)}</p></div>
          <div className="rounded-lg bg-bg p-2"><p className="text-xs text-muted">المدفوع</p><p className="font-bold">{formatEGP(paid)}</p></div>
          <div className="rounded-lg bg-bg p-2"><p className="text-xs text-muted">المتبقي</p><p className="font-bold">{formatEGP(remaining)}</p></div>
        </div>
      )}

      {canSeeProfit && profit.data && profit.data.profit != null && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-bg px-3 py-2 text-xs text-muted">
          <span>تكلفة القطع: <b className="text-fg">{formatEGP(toMinor(profit.data.parts_cost ?? 0))}</b></span>
          <span>صافي الربح: <b className={toMinor(profit.data.profit) < 0 ? 'text-danger' : 'text-ok'}>{formatEGP(toMinor(profit.data.profit))}</b></span>
          <span>{profit.data.realized ? 'اتحقق بعد التسليم' : 'متوقع، لسه ما اتسلّمش'}</span>
        </p>
      )}

      {canTake && !order.customer_id && customers.data && (
        <div className="space-y-2 rounded-lg bg-bg p-3">
          <CustomerPicker customers={customers.data} loading={customers.isLoading} value={linkCust} onChange={setLinkCust} />
          <div className="flex flex-wrap items-center gap-2">
            <Button small disabled={!linkCust || link.isPending} onClick={() => link.mutate()}>{link.isPending ? 'جارٍ الربط…' : 'اربط الأمر بحساب العميل'}</Button>
            <span className="text-xs text-muted">لازم الأمر يتربط بعميل عشان المتبقي يتسجل على حسابه عند التسليم.</span>
          </div>
          <ErrorText error={link.error} />
        </div>
      )}

      {payments.data && payments.data.length > 0 && (
        <ul className="space-y-1">
          {payments.data.map((p) => (
            <li key={p.id} className="flex flex-wrap justify-between gap-2">
              <span>{PAYMENT_KIND[p.kind]} · {PAY_METHOD[p.method]} <span className="text-muted">· {formatCairo(p.created_at)}</span>{p.note && <span className="text-muted" dir="auto"> · {p.note}</span>}</span>
              <span className={p.kind === 'refund' ? 'text-danger' : ''}>{p.kind === 'refund' ? '- ' : ''}{formatEGP(toMinor(p.amount))}</span>
            </li>
          ))}
        </ul>
      )}

      {canTake && priced && (remaining > 0 || refund) && (
        <form className="grid gap-2 rounded-lg bg-bg p-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); pay.mutate(refund ? 'refund' : kind) }}>
          {!refund && (
            <Field label="النوع"><select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as 'deposit' | 'payment')}>
              <option value="deposit">عربون</option><option value="payment">دفعة</option></select></Field>
          )}
          <Field label="طريقة الدفع"><select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as keyof typeof PAY_METHOD)}>
            {Object.entries(PAY_METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {method !== 'cash' && <Field label="الحساب"><AccountSelect value={account} onChange={setAccount} /></Field>}
          <Field label={refund ? 'المبلغ المردود' : 'المبلغ'}>
            <input className={inputCls} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder={refund ? '' : fromMinor(remaining)} /></Field>
          <Field label={refund ? 'السبب (مطلوب)' : 'ملاحظة'}><input className={inputCls} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-4">
            <Button variant="primary" disabled={pay.isPending}>{pay.isPending ? 'جارٍ الحفظ…' : refund ? 'تسجيل المردود' : 'تسجيل الدفع'}</Button>
            {!refund && remaining > 0 && <Button type="button" small onClick={() => setAmount(fromMinor(remaining))}>سدد المتبقي {formatEGP(remaining)}</Button>}
            {refund && <Button type="button" small onClick={() => setRefund(false)}>رجوع</Button>}
            {method === 'cash' && <span className="text-xs text-muted">النقدي بيدخل درج الصيانة ويحتاج وردية مفتوحة.</span>}
          </div>
        </form>
      )}
      {canRefund && paid > 0 && !refund && <Button small variant="danger" onClick={() => { setRefund(true); setAmount(''); setNote('') }}>رد مبلغ للعميل</Button>}
      <ErrorText error={pay.error} />

      {canDeliver && (
        <div className="space-y-2 rounded-lg border border-line bg-bg p-3">
          <h4 className="font-semibold">تسليم الجهاز للعميل</h4>
          {needsBalanceOk && (
            <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-warn">
              فاضل على العميل {formatEGP(remaining)}. {order.customer_id ? 'سدد المتبقي، أو سلّمه والمتبقي على حساب العميل.'
                : canRefund ? 'سدد المتبقي، أو سلّم بمتبقي بسبب مكتوب.' : 'لازم يتسدد المتبقي قبل التسليم.'}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            {order.status === 'ready' && (
              <Field label="مدة الضمان">
                <select className={inputCls} value={warranty} onChange={(e) => setWarranty(Number(e.target.value))}>
                  {WARRANTY_CHOICES.map((d) => <option key={d} value={d}>{d === 0 ? 'بدون ضمان' : `${d} يوم`}</option>)}
                </select>
              </Field>
            )}
            <Field label={withBalance ? 'سبب التسليم بمتبقي (مطلوب)' : 'ملاحظة التسليم'} className="sm:col-span-2">
              <input className={inputCls} dir="auto" value={handNote} onChange={(e) => setHandNote(e.target.value)} />
            </Field>
          </div>
          {needsBalanceOk && order.customer_id && (
            <label className="flex items-center gap-2"><input type="checkbox" checked={onCustomer} onChange={(e) => setOnCustomer(e.target.checked)} />
              سلّم الجهاز والمتبقي {formatEGP(remaining)} يتسجل على حساب العميل (في حدود الآجل بتاعه)</label>
          )}
          {needsBalanceOk && !order.customer_id && canRefund && (
            <label className="flex items-center gap-2"><input type="checkbox" checked={withBalance} onChange={(e) => setWithBalance(e.target.checked)} />
              سلّم الجهاز والمتبقي {formatEGP(remaining)} لسه على العميل</label>
          )}
          <ErrorText error={deliver.error} />
          <Button variant="primary"
            disabled={deliver.isPending || (needsBalanceOk && !(onCustomer || (withBalance && handNote.trim())))} onClick={() => deliver.mutate()}>
            {deliver.isPending ? 'جارٍ التسليم…' : 'تأكيد التسليم'}
          </Button>
        </div>
      )}

      {canCancelDelivery && (
        <div className="space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-3">
          <h4 className="font-semibold">إلغاء التسليم</h4>
          <p className="text-xs text-muted">
            بيرجّع الأمر للشغل، ويرد المدفوع من درج الصيانة أو الحساب، ويشيل المتبقي من حساب العميل، ويرجّع القطع للمخزن. محتاج وردية مفتوحة.
            {!isOwner && ' المدير محتاج موافقة المالك بالرقم السري.'}
          </p>
          <Field label="سبب الإلغاء (مطلوب)">
            <input className={inputCls} dir="auto" maxLength={250} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </Field>
          <ErrorText error={cancelDelivery.error} />
          <Button variant="danger" disabled={!cancelReason.trim() || cancelDelivery.isPending}
            onClick={() => (isOwner ? cancelDelivery.mutate(null) : setPinOpen(true))}>
            {cancelDelivery.isPending ? 'جارٍ الإلغاء…' : 'إلغاء التسليم'}
          </Button>
          <ApproverPin open={pinOpen} onClose={() => setPinOpen(false)} reason={`إلغاء تسليم أمر صيانة RP-${order.order_number}`}
            onToken={(token) => cancelDelivery.mutate(token)} />
        </div>
      )}
    </section>
  )
}
