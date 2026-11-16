import { useQuery } from '@tanstack/react-query'
import { formatEGP, fromMinor, toMinor } from './money'
import { escapeHtml, printDocument } from './print'
import { supabase } from './supabase'
import { cairoBusinessDate, formatCairo } from './time'

export const WALLET_MODE = {
  receive: 'استقبال (العميل ياخد نقدية)',
  send: 'إرسال (العميل يدفع نقدية)',
  send_credit: 'إرسال آجل (يدفع بعدين)',
  receive_credit: 'استقبال آجل (التحويل ييجي بعدين)',
} as const
export type WalletMode = keyof typeof WALLET_MODE
export const WALLET_MODE_SHORT: Record<WalletMode, string> = {
  receive: 'استقبال', send: 'إرسال', send_credit: 'إرسال آجل', receive_credit: 'استقبال آجل',
}
export const isCreditMode = (m: WalletMode) => m === 'send_credit' || m === 'receive_credit'

export const WALLET_STATUS = { done: 'تمت', pending: 'بانتظار التحويل', cancelled: 'ملغاة' } as const
export type WalletStatus = keyof typeof WALLET_STATUS
export const STATUS_TONE = { done: 'ok', pending: 'warn', cancelled: 'danger' } as const

export type WalletOp = {
  id: string
  op_no: string
  account_id: string
  mode: WalletMode
  amount: number | string
  commission: number | string
  customer_id: string | null
  party_phone: string | null
  status: WalletStatus
  note: string | null
  business_date: string
  created_by: string
  created_at: string
  settled_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
}

export const BILL_KIND = { bill: 'فاتورة / خدمة', machine: 'سحب من ماكينة' } as const
export const BILL_PAY = { cash: 'نقدي', credit: 'آجل' } as const
export const BILL_STATUS = { done: 'تمت', cancelled: 'ملغاة' } as const

export type BillService = { id: string; name: string; default_commission: number | string; sort_order: number; is_active: boolean }
export type BillOp = {
  id: string
  op_no: string
  kind: keyof typeof BILL_KIND
  account_id: string
  service_id: string | null
  service_name: string | null
  amount: number | string
  commission: number | string
  pay: keyof typeof BILL_PAY
  customer_id: string | null
  reference: string | null
  status: keyof typeof BILL_STATUS
  group_id: string
  business_date: string
  created_by: string
  created_at: string
  cancelled_at: string | null
  cancel_reason: string | null
}

export function useWalletOps(from: string, to: string) {
  return useQuery({
    queryKey: ['wallet-ops', from, to],
    enabled: !!from && !!to && from <= to,
    queryFn: async () => {
      const { data, error } = await supabase.from('wallet_operations').select('*')
        .gte('business_date', from).lte('business_date', to).order('created_at', { ascending: false }).limit(1000)
      if (error) throw error
      return data as WalletOp[]
    },
  })
}

export function useBillOps(from: string, to: string) {
  return useQuery({
    queryKey: ['bill-ops', from, to],
    enabled: !!from && !!to && from <= to,
    queryFn: async () => {
      const { data, error } = await supabase.from('bill_operations').select('*')
        .gte('business_date', from).lte('business_date', to).order('created_at', { ascending: false }).limit(1000)
      if (error) throw error
      return data as BillOp[]
    },
  })
}

export function useBillServices() {
  return useQuery({
    queryKey: ['bill-services'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bill_services').select('id,name,default_commission,sort_order,is_active').order('sort_order').order('name')
      if (error) throw error
      return data as BillService[]
    },
  })
}

// ---------- date filter ----------
export const RANGE_PRESET = { today: 'اليوم', week: 'آخر 7 أيام', month: 'هذا الشهر', custom: 'فترة محددة' } as const
export type RangePreset = keyof typeof RANGE_PRESET

/** Cairo business dates (YYYY-MM-DD) for a preset. */
export function rangeOf(preset: RangePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const today = cairoBusinessDate()
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'week') return { from: cairoBusinessDate(new Date(Date.now() - 6 * 86_400_000)), to: today }
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today }
  return { from: customFrom, to: customTo }
}

// ---------- money helpers ----------
export const egp = (v: number | string | null | undefined) => formatEGP(toMinor(v ?? 0))

/** Text field -> minor units. Empty text counts as zero. Throws an Arabic message. */
export function parseAmount(text: string, allowZero = false): number {
  const t = text.trim()
  if (!t && allowZero) return 0
  let m: number
  try { m = toMinor(t) } catch { throw new Error('أدخل مبلغًا صحيحًا (بحد أقصى خانتين عشريتين).') }
  if (m < 0 || (!allowZero && m === 0)) throw new Error('أدخل مبلغًا صحيحًا أكبر من صفر.')
  return m
}
/** Same as parseAmount but never throws: returns 0 for anything invalid (for live previews). */
export function softAmount(text: string): number {
  try { return parseAmount(text, true) } catch { return 0 }
}
export const toDb = (minor: number) => Number(fromMinor(minor))

/** What one wallet operation does to the wallet, the wallets drawer and the customer's debt (minor units). */
export function walletEffect(mode: WalletMode, amount: number, commission: number) {
  switch (mode) {
    case 'receive': return { wallet: amount, drawer: -(amount - commission), debt: 0 }
    case 'send': return { wallet: -amount, drawer: amount + commission, debt: 0 }
    case 'send_credit': return { wallet: -amount, drawer: 0, debt: amount + commission }
    case 'receive_credit': return { wallet: 0, drawer: -(amount - commission), debt: amount }
  }
}

/** One plain line that tells the cashier what will happen. */
export function explainWallet(mode: WalletMode, amount: number, commission: number): string {
  const a = formatEGP(amount), c = formatEGP(commission)
  const net = formatEGP(Math.max(0, amount - commission)), gross = formatEGP(amount + commission)
  switch (mode) {
    case 'receive':
      return `العميل يحوّل ${a} على محفظتنا وياخد ${net} نقدًا من درج المحافظ. المحفظة تزيد ${a}، الدرج ينقص ${net}، وعمولتنا ${c}.`
    case 'send':
      return `العميل يدفع ${gross} نقدًا ونحوّل له ${a}. المحفظة تنقص ${a}، درج المحافظ يزيد ${gross}، وعمولتنا ${c}.`
    case 'send_credit':
      return `نحوّل للعميل ${a} الآن ويدفع بعدين. المحفظة تنقص ${a}، الدرج لا يتغير، ويتسجل على العميل دين ${gross} (منها عمولة ${c}).`
    case 'receive_credit':
      return `نسلّم العميل ${net} نقدًا الآن والتحويل ييجي بعدين. الدرج ينقص ${net}، المحفظة لا تتغير الآن، ويتسجل على العميل ${a} لحد ما التحويل يوصل.`
  }
}

// ---------- errors the shared map does not know yet ----------
const OP_ERR: [RegExp, string][] = [
  [/invalid amount/i, 'المبلغ أو العمولة غير صحيحة (في الاستقبال لازم العمولة تكون أقل من المبلغ).'],
  [/invalid operation/i, 'نوع العملية غير صحيح.'],
  [/customer required/i, 'العملية الآجلة تحتاج عميلًا مسجلًا. اختر العميل أولًا.'],
  [/operation not pending/i, 'العملية دي مش بانتظار تحويل (اتسوّت أو اتلغت). حدّث الصفحة.'],
  [/operation already cancelled/i, 'العملية ملغاة بالفعل.'],
  [/invalid service/i, 'الخدمة غير موجودة أو موقوفة.'],
  [/invalid count/i, 'عدد التكرار لازم يكون من 1 إلى 20.'],
  [/idempotency key required/i, 'تعذّر تجهيز العملية. حدّث الصفحة وحاول تاني.'],
  [/insufficient drawer balance/i, 'النقدية في الدرج لا تكفي لهذه العملية.'],
  [/no open cash session/i, 'لا توجد وردية مفتوحة. افتح الوردية أولًا من صفحة «الدرج».'],
  [/bill_services_name_key|duplicate key/i, 'توجد خدمة بنفس الاسم.'],
  [/bill_services_name_check/i, 'اسم الخدمة لازم يكون من حرفين إلى 60 حرفًا.'],
]
/** Turns a database error into an Arabic one when we know it; otherwise returns it unchanged for the shared map. */
export function opError(e: { message?: string } | null | undefined): Error {
  const m = e?.message ?? ''
  const known = OP_ERR.find(([re]) => re.test(m))?.[1]
  return new Error(known ?? m)
}
export const needsPin = (e: unknown) => /override required|override invalid/i.test((e as { message?: string })?.message ?? '')

// ---------- receipts ----------
const row = (label: string, value: string) => `<tr><th style="width:40%">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
const receiptCss = '<style>body{max-width:320px;margin:12px auto} h1{font-size:16px;text-align:center} .muted{text-align:center} th,td{padding:5px 6px;font-size:12px}</style>'

export function printWalletReceipt(op: WalletOp, walletName: string, customerName: string | null) {
  const a = toMinor(op.amount), c = toMinor(op.commission)
  const eff = walletEffect(op.mode, a, c)
  const cashLine = eff.drawer > 0 ? row('المدفوع نقدًا', formatEGP(eff.drawer)) : eff.drawer < 0 ? row('المستلم نقدًا', formatEGP(-eff.drawer)) : ''
  printDocument(`إيصال ${op.op_no}`, `${receiptCss}
    <h1>إيصال تحويل محفظة</h1>
    <p class="muted"><bdi>${escapeHtml(op.op_no)}</bdi> · ${escapeHtml(formatCairo(op.created_at))}</p>
    <table>
      ${row('العملية', WALLET_MODE_SHORT[op.mode])}
      ${row('المحفظة', walletName)}
      ${op.party_phone ? row('رقم الطرف الآخر', op.party_phone) : ''}
      ${customerName ? row('العميل', customerName) : ''}
      ${row('مبلغ التحويل', formatEGP(a))}
      ${row('العمولة', formatEGP(c))}
      ${cashLine}
      ${eff.debt > 0 ? row('على حساب العميل', formatEGP(eff.debt)) : ''}
      ${row('الحالة', WALLET_STATUS[op.status])}
      ${op.note ? row('ملاحظة', op.note) : ''}
    </table>
    <p class="muted">شكرًا لتعاملكم معنا</p>`)
}

/** One receipt for one bill group (a repeated bill prints as one receipt with every number). */
export function printBillReceipt(ops: BillOp[], accountName: string, customerName: string | null) {
  if (!ops.length) return
  const first = ops[0]
  const a = toMinor(first.amount), c = toMinor(first.commission), n = ops.length
  const machine = first.kind === 'machine'
  const nos = ops.map((o) => o.op_no).sort()
  printDocument(`إيصال ${nos[0]}`, `${receiptCss}
    <h1>${machine ? 'إيصال سحب من ماكينة' : 'إيصال دفع خدمة'}</h1>
    <p class="muted"><bdi>${escapeHtml(n > 1 ? `${nos[0]} - ${nos[n - 1]}` : nos[0])}</bdi> · ${escapeHtml(formatCairo(first.created_at))}</p>
    <table>
      ${row('الخدمة', first.service_name ?? BILL_KIND[first.kind])}
      ${row(machine ? 'الماكينة' : 'الدفع من', accountName)}
      ${first.reference ? row('الرقم المرجعي', first.reference) : ''}
      ${customerName ? row('العميل', customerName) : ''}
      ${row(machine ? 'المبلغ المسحوب' : 'قيمة الفاتورة', formatEGP(a))}
      ${row('العمولة', formatEGP(c))}
      ${n > 1 ? row('عدد المرات', String(n)) : ''}
      ${machine
        ? row('المستلم نقدًا', formatEGP(a)) + row('المخصوم من البطاقة', formatEGP(a + c))
        : row(first.pay === 'credit' ? 'على حساب العميل' : 'المدفوع نقدًا', formatEGP((a + c) * n))}
      ${first.status === 'cancelled' ? row('الحالة', BILL_STATUS.cancelled) : ''}
    </table>
    <p class="muted">شكرًا لتعاملكم معنا</p>`)
}
