export const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

type PrintStore = {
  store_name: string; phone: string; address: string; tax_number: string; paper: string
  footer_sale: string; footer_return: string; footer_repair: string; footer_installment: string
  footer_wallet: string; footer_bill: string; footer_tradein: string
}
export type PrintFooter = 'sale' | 'return' | 'repair' | 'installment' | 'wallet' | 'bill' | 'tradein'

let store: PrintStore | null = null
/** Set once by useStoreSettings (lib/store.ts). Until then documents print without the store header. */
export function setPrintStore(s: PrintStore) { store = s }

const PAGE: Record<string, { size: string; margin: string; narrow: boolean }> = {
  '58mm': { size: '58mm auto', margin: '3mm', narrow: true },
  '80mm': { size: '80mm auto', margin: '4mm', narrow: true },
  A5: { size: 'A5', margin: '10mm', narrow: false },
  A4: { size: 'A4', margin: '14mm', narrow: false },
}

/**
 * Prints an RTL document through a hidden iframe (no popup, so popup blockers cannot stop it).
 * The store name, phone, address and tax number from the settings are added on top, and the footer text
 * of the given document type at the bottom, only when `opts.footer` is given (receipts and invoices).
 * Without it the document prints plain on A4 as before (labels, lists, reports). `opts.paper` forces a size.
 */
export function printDocument(title: string, bodyHtml: string, opts: { footer?: PrintFooter; paper?: string } = {}) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  if (!doc) { frame.remove(); return }
  const receipt = !!opts.footer
  const page = PAGE[opts.paper ?? (receipt ? store?.paper : undefined) ?? 'A4'] ?? PAGE.A4
  const head = receipt && store?.store_name
    ? `<header class="store"><strong>${escapeHtml(store.store_name)}</strong>${
        [store.phone, store.address, store.tax_number && `الرقم الضريبي: ${store.tax_number}`].filter(Boolean)
          .map((t) => `<div class="muted">${escapeHtml(t)}</div>`).join('')}</header>`
    : ''
  const footText = opts.footer && store ? store[`footer_${opts.footer}`] : ''
  const foot = footText ? `<footer class="foot">${escapeHtml(footText)}</footer>` : ''
  doc.open()
  doc.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  ${receipt || opts.paper ? `@page{size:${page.size};margin:${page.margin}}` : ''}
  body{font-family:Tahoma,Arial,sans-serif;margin:${page.narrow ? '0' : '24px'};color:#111;font-size:${page.narrow ? '11px' : '13px'}}
  h1{font-size:${page.narrow ? '14px' : '20px'};margin:0 0 4px} .muted{color:#555;font-size:${page.narrow ? '10px' : '12px'}}
  table{width:100%;border-collapse:collapse;margin:${page.narrow ? '8px' : '16px'} 0} th,td{border:1px solid #bbb;padding:${page.narrow ? '3px' : '8px'};text-align:start;font-size:${page.narrow ? '10px' : '13px'}}
  th{background:#f2f2f2} .total{font-size:${page.narrow ? '13px' : '16px'};font-weight:bold;text-align:end}
  .sign{display:flex;justify-content:space-between;margin-top:48px;font-size:12px}
  .store{text-align:center;border-bottom:1px dashed #999;padding-bottom:6px;margin-bottom:8px} .store strong{font-size:${page.narrow ? '15px' : '20px'}}
  .foot{text-align:center;border-top:1px dashed #999;margin-top:10px;padding-top:6px;font-size:${page.narrow ? '10px' : '12px'};color:#333;white-space:pre-wrap}
</style></head><body>${head}${bodyHtml}${foot}</body></html>`)
  doc.close()
  const go = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 2000) }
  if (doc.readyState === 'complete') go()
  else frame.onload = go
}
