export const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/** Prints an RTL document through a hidden iframe (no popup, so popup blockers cannot stop it). */
export function printDocument(title: string, bodyHtml: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  if (!doc) { frame.remove(); return }
  doc.open()
  doc.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body{font-family:Tahoma,Arial,sans-serif;margin:24px;color:#111}
  h1{font-size:20px;margin:0 0 4px} .muted{color:#555;font-size:12px}
  table{width:100%;border-collapse:collapse;margin:16px 0} th,td{border:1px solid #bbb;padding:8px;text-align:start;font-size:13px}
  th{background:#f2f2f2} .total{font-size:16px;font-weight:bold;text-align:end}
  .sign{display:flex;justify-content:space-between;margin-top:48px;font-size:12px}
</style></head><body>${bodyHtml}</body></html>`)
  doc.close()
  const go = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 2000) }
  if (doc.readyState === 'complete') go()
  else frame.onload = go
}
