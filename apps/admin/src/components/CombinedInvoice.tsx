import { useState } from 'react'
import { escapeHtml, printDocument } from '../lib/print'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { formatCairo } from '../lib/time'
import { Button, Field, inputCls, Modal } from './ui'

type Device = { name: string; issue: string }

/** Manual invoice for several devices in one document. It creates no repair orders and moves no money. */
export default function CombinedInvoice({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [devices, setDevices] = useState<Device[]>([{ name: '', issue: '' }])
  const [total, setTotal] = useState('')
  const [warranty, setWarranty] = useState('')
  const [preview, setPreview] = useState(false)

  let totalMinor = NaN
  try { totalMinor = total.trim() ? toMinor(total) : NaN } catch { totalMinor = NaN }
  const filled = devices.filter((d) => d.name.trim())
  const valid = filled.length > 0 && Number.isFinite(totalMinor) && totalMinor >= 0
  const set = (i: number, patch: Partial<Device>) => setDevices(devices.map((d, j) => (j === i ? { ...d, ...patch } : d)))

  function print() {
    const rows = filled.map((d, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(d.name)}</td><td>${escapeHtml(d.issue)}</td></tr>`).join('')
    printDocument('فاتورة صيانة تجميعية', `
      <h1>فاتورة صيانة</h1><p class="muted">${escapeHtml(formatCairo(new Date().toISOString()))}</p>
      <p>العميل: <b>${escapeHtml(name) || '—'}</b> &nbsp; الموبايل: <b dir="ltr">${escapeHtml(phone) || '—'}</b></p>
      <table><thead><tr><th>#</th><th>الجهاز</th><th>العيب / الصيانة</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="total">الإجمالي: ${escapeHtml(formatEGP(totalMinor))}</p>
      ${warranty.trim() ? `<p>الضمان: ${escapeHtml(warranty)}</p>` : ''}
      <div class="sign"><span>توقيع العميل</span><span>توقيع المحل</span></div>`)
  }

  return (
    <Modal open wide onClose={onClose} title="فاتورة صيانة تجميعية"
      footer={preview
        ? <><Button onClick={() => setPreview(false)}>تعديل</Button><Button variant="primary" onClick={print}>طباعة</Button></>
        : <><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={!valid} onClick={() => setPreview(true)}>معاينة</Button></>}>
      <p className="mb-3 text-sm text-muted">فاتورة يدوية لعدة أجهزة في مستند واحد. لا تنشئ أوامر صيانة ولا تؤثر على أي أرصدة أو تقارير.</p>
      {!preview ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="اسم العميل (اختياري)"><input className={inputCls} dir="auto" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="رقم الموبايل (اختياري)"><input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          </div>
          {devices.map((d, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-line p-3">
              <div className="flex items-center justify-between"><p className="font-semibold">الجهاز {i + 1}</p>
                {devices.length > 1 && <Button small variant="danger" onClick={() => setDevices(devices.filter((_, j) => j !== i))}>حذف</Button>}</div>
              <input className={inputCls} dir="auto" placeholder="اسم الجهاز / المنتج" aria-label="اسم الجهاز" value={d.name} onChange={(e) => set(i, { name: e.target.value })} />
              <textarea className={inputCls} rows={2} dir="auto" placeholder="وصف العيب / الصيانة" aria-label="وصف العيب" value={d.issue} onChange={(e) => set(i, { issue: e.target.value })} />
            </div>
          ))}
          <Button type="button" className="w-full border-dashed" onClick={() => setDevices([...devices, { name: '', issue: '' }])}>+ إضافة جهاز آخر</Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الإجمالي (إلزامي)"><input className={inputCls} dir="ltr" inputMode="decimal" placeholder="0.00" value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
            <Field label="الضمان (اختياري)"><input className={inputCls} dir="auto" placeholder="مثال: 30 يوم / بدون ضمان" value={warranty} onChange={(e) => setWarranty(e.target.value)} /></Field>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-line bg-bg p-4 text-sm">
          <h3 className="text-lg font-bold">فاتورة صيانة</h3>
          <p>العميل: <b dir="auto">{name || '—'}</b> · الموبايل: <b dir="ltr">{phone || '—'}</b></p>
          <ol className="list-decimal space-y-1 ps-5">{filled.map((d, i) => <li key={i}><b dir="auto">{d.name}</b>{d.issue && <span className="text-muted" dir="auto"> — {d.issue}</span>}</li>)}</ol>
          <p className="text-base font-bold">الإجمالي: {formatEGP(totalMinor)}</p>
          {warranty.trim() && <p>الضمان: {warranty}</p>}
          <p className="text-xs text-muted">القيمة المحفوظة للطباعة: {fromMinor(totalMinor)} جنيه</p>
        </div>
      )}
    </Modal>
  )
}
