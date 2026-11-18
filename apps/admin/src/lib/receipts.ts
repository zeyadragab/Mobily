import { formatEGP, toMinor } from './money'
import { escapeHtml, printDocument } from './print'
import { whatsappDigits } from './repairs'
import { formatCairo } from './time'

/** Printed documents and WhatsApp links for the sale invoice, return, installment receipt, repair receipt and trade-in contract.
 *  The store header and the footer text come from the store settings (lib/print.ts); the paper size too. */

const money = (v: number | string) => formatEGP(toMinor(v))
const row = (label: string, value: string) => `<tr><th style="width:40%">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`

/** wa.me link. The message is opened by the person, nothing is sent by the app. Null when there is no usable phone. */
export function waLink(phone: string | null | undefined, text: string): string | null {
  const d = whatsappDigits(phone ?? '')
  return d.length >= 8 ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : null
}

export type SaleDoc = {
  invoice_number: string; created_at: string; customer_name: string | null; customer_phone: string | null
  subtotal: string; discount: string; total: string; notes: string | null
  lines: { name: string; qty: number; unit_price: string; serials: string[] | null }[]
  payments: { label: string; amount: string }[]
  /** the customer's debt right now (after this invoice); shown only when the store setting allows it */
  balance?: number | null
}

export function printSaleInvoice(d: SaleDoc, showBalance: boolean) {
  const lines = d.lines.map((l) => `<tr><td>${escapeHtml(l.name)}${l.serials?.length ? `<div class="muted" dir="ltr">${escapeHtml(l.serials.join(' · '))}</div>` : ''}</td>
    <td>${l.qty}</td><td>${escapeHtml(money(l.unit_price))}</td><td>${escapeHtml(formatEGP(toMinor(l.unit_price) * l.qty))}</td></tr>`).join('')
  const pays = d.payments.map((p) => `<tr><td>${escapeHtml(p.label)}</td><td>${escapeHtml(money(p.amount))}</td></tr>`).join('')
  printDocument(`فاتورة ${d.invoice_number}`, `
    <h1>فاتورة بيع <bdi>${escapeHtml(d.invoice_number)}</bdi></h1>
    <p class="muted">${escapeHtml(formatCairo(d.created_at))}</p>
    ${d.customer_name || d.customer_phone ? `<p>العميل: <b>${escapeHtml(d.customer_name ?? '')}</b> <bdi>${escapeHtml(d.customer_phone ?? '')}</bdi></p>` : ''}
    <table><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${lines}</tbody></table>
    ${toMinor(d.discount) > 0 ? `<p class="muted">الإجمالي قبل الخصم: ${escapeHtml(money(d.subtotal))} · الخصم: ${escapeHtml(money(d.discount))}</p>` : ''}
    <p class="total">الصافي: ${escapeHtml(money(d.total))}</p>
    ${pays ? `<table><tbody>${pays}</tbody></table>` : ''}
    ${showBalance && d.balance != null && d.balance > 0 ? `<p class="total">الرصيد الحالي على العميل: ${escapeHtml(formatEGP(d.balance))}</p>` : ''}
    ${d.notes ? `<p class="muted">${escapeHtml(d.notes)}</p>` : ''}`, { footer: 'sale' })
}

export function saleWhatsApp(d: SaleDoc, storeName: string): string | null {
  const body = d.lines.map((l) => `• ${l.name} × ${l.qty}`).join('\n')
  return waLink(d.customer_phone, `${storeName ? `${storeName}\n` : ''}فاتورة رقم ${d.invoice_number}\n${body}\nالإجمالي: ${money(d.total)}\nشكرًا لتعاملكم معنا.`)
}

export type ReturnDoc = {
  return_number: string; created_at: string; invoice_number: string; customer_name: string | null; reason: string
  refund_total: string; debt_reduction: string; manual_reduction: string; refund_label: string
}
export function printReturnReceipt(d: ReturnDoc) {
  printDocument(`مرتجع ${d.return_number}`, `
    <h1>إيصال مرتجع <bdi>${escapeHtml(d.return_number)}</bdi></h1>
    <p class="muted">${escapeHtml(formatCairo(d.created_at))}</p>
    <table>
      ${row('الفاتورة الأصلية', d.invoice_number)}
      ${d.customer_name ? row('العميل', d.customer_name) : ''}
      ${row('السبب', d.reason)}
      ${toMinor(d.refund_total) > 0 ? row(`المدفوع للعميل (${d.refund_label})`, money(d.refund_total)) : ''}
      ${toMinor(d.debt_reduction) > 0 ? row('خصم من مديونية العميل', money(d.debt_reduction)) : ''}
      ${toMinor(d.manual_reduction) > 0 ? row('خصم مصاريف المرتجع', money(d.manual_reduction)) : ''}
    </table>
    <div class="sign"><span>توقيع العميل: ____________</span><span>توقيع الموظف: ____________</span></div>`, { footer: 'return' })
}

export type InstallmentDoc = { receipt_no: string; plan_no: string | null; customer: string | null; amount: string | number; method: string; created_at: string }
export function printInstallmentReceipt(d: InstallmentDoc) {
  printDocument(`إيصال ${d.receipt_no}`, `
    <h1>إيصال تحصيل قسط <bdi>${escapeHtml(d.receipt_no)}</bdi></h1>
    <p class="muted">${escapeHtml(formatCairo(d.created_at))}</p>
    <table>
      ${d.plan_no ? row('الخطة', d.plan_no) : ''}
      ${d.customer ? row('العميل', d.customer) : ''}
      ${row('المبلغ المحصّل', money(d.amount))}
      ${row('طريقة الدفع', d.method)}
    </table>
    <div class="sign"><span>توقيع العميل: ____________</span><span>توقيع الموظف: ____________</span></div>`, { footer: 'installment' })
}

export type RepairDoc = {
  number: string; received_at: string; due_at: string | null; customer_name: string; customer_phone: string | null
  device_model: string; serial: string | null; imei1: string | null; complaint: string; intake_condition: string; accessories: string | null
  quote_total: number | string | null; warranty_days: number | null
}
export function printRepairReceipt(d: RepairDoc) {
  printDocument(`إيصال صيانة ${d.number}`, `
    <h1>إيصال استلام جهاز للصيانة <bdi>${escapeHtml(d.number)}</bdi></h1>
    <p class="muted">${escapeHtml(formatCairo(d.received_at))}</p>
    <table>
      ${row('العميل', `${d.customer_name}${d.customer_phone ? ` - ${d.customer_phone}` : ''}`)}
      ${row('الجهاز', d.device_model)}
      ${d.serial ? row('السيريال', d.serial) : ''}${d.imei1 ? row('IMEI', d.imei1) : ''}
      ${row('الشكوى', d.complaint)}
      ${row('حالة الاستلام', d.intake_condition)}
      ${d.accessories ? row('الملحقات', d.accessories) : ''}
      ${d.due_at ? row('موعد التسليم المتوقع', formatCairo(d.due_at)) : ''}
      ${d.quote_total != null && toMinor(d.quote_total) > 0 ? row('قيمة الصيانة', money(d.quote_total)) : ''}
      ${d.warranty_days ? row('ضمان الصيانة (يوم)', String(d.warranty_days)) : ''}
    </table>
    <div class="sign"><span>توقيع العميل: ____________</span><span>توقيع الموظف: ____________</span></div>`, { footer: 'repair' })
}

export type TradeDoc = {
  trade_no: string; created_at: string; product: string; serial: string; price: string | number
  seller_name: string; seller_phone: string | null; condition_note: string | null
}
/** The national id is written by hand on the printed contract: it is kept apart in the database and is not read by this screen. */
export function printTradeInContract(d: TradeDoc) {
  printDocument(`عقد شراء ${d.trade_no}`, `
    <h1>عقد شراء جهاز مستعمل <bdi>${escapeHtml(d.trade_no)}</bdi></h1>
    <p class="muted">${escapeHtml(formatCairo(d.created_at))}</p>
    <table>
      ${row('البائع', d.seller_name)}
      ${d.seller_phone ? row('موبايل البائع', d.seller_phone) : ''}
      <tr><th style="width:40%">الرقم القومي للبائع</th><td>&nbsp;</td></tr>
      ${row('الجهاز', d.product)}
      ${row('السيريال / IMEI', d.serial)}
      ${d.condition_note ? row('حالة الجهاز', d.condition_note) : ''}
      ${row('الثمن المدفوع', money(d.price))}
    </table>
    <p>أقر أنا البائع بأن الجهاز المذكور ملكي، وليس مسروقًا أو مرهونًا، وأنني بعته للمحل بالثمن المذكور وتسلمته كاملًا.</p>
    <div class="sign"><span>توقيع البائع: ____________</span><span>توقيع المستلم: ____________</span></div>`, { footer: 'tradein' })
}
