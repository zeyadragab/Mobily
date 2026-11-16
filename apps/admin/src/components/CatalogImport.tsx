import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { IMPORT_COLUMNS, rowsFromCsv } from '../lib/catalog'
import { downloadCsv } from '../lib/repairs'
import { Button, ErrorText, Modal } from './ui'

type Result = { applied: boolean; rows: number; created?: number; updated?: number; errors: { row: number; error: string }[] }

const ERROR_AR: Record<string, string> = {
  'sku and name required': 'الاسم و SKU مطلوبان',
  'text too long': 'نص أطول من المسموح',
  'duplicate sku in file': 'SKU مكرر داخل الملف',
  'invalid condition': 'الحالة غير صحيحة (جديد / مستعمل / مجدد)',
  'invalid price': 'سعر البيع غير صحيح',
  'invalid wholesale price': 'سعر الجملة غير صحيح',
  'invalid cost': 'التكلفة غير صحيحة',
  'invalid number': 'رقم غير صحيح (حد الطلب أو الضمان)',
  'barcode used by another item': 'الباركود مستخدم لصنف آخر',
  'sku belongs to another product': 'هذا الـ SKU تابع لمنتج باسم مختلف',
}

/** CSV import with a check first: nothing is written until the file has no errors and the user confirms. */
export default function CatalogImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [res, setRes] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)

  function reset() { setRows([]); setFileName(''); setRes(null); setErr(null); setBusy(false) }
  function close() { reset(); onClose() }

  async function pick(file: File | undefined) {
    reset()
    if (!file) return
    if (file.size > 2_000_000) return setErr(new Error('الملف أكبر من 2 ميجا.'))
    const parsed = rowsFromCsv(await file.text())
    if (parsed.length === 0) return setErr(new Error('الملف فارغ أو بدون صفوف. استخدم ملف CSV بعناوين الأعمدة.'))
    if (parsed.length > 2000) return setErr(new Error('الحد الأقصى 2000 صف في المرة.'))
    setRows(parsed); setFileName(file.name)
    await send(parsed, false)
  }

  async function send(data: Record<string, string>[], apply: boolean) {
    setBusy(true); setErr(null)
    const { data: out, error } = await supabase.rpc('import_catalog', { p_rows: data, p_apply: apply })
    setBusy(false)
    if (error) return setErr(error)
    setRes(out as Result)
    if (apply && (out as Result).applied) {
      ;['products', 'costs', 'categories', 'stock'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }))
    }
  }

  const errCount = res?.errors.length ?? 0
  return (
    <Modal open={open} onClose={close} title="استيراد منتجات من ملف CSV" wide
      footer={<>
        <Button onClick={close}>{res?.applied ? 'تم' : 'إلغاء'}</Button>
        {!res?.applied && <Button variant="primary" disabled={busy || rows.length === 0 || errCount > 0} onClick={() => void send(rows, true)}>{busy ? 'جارٍ الاستيراد…' : `استيراد ${rows.length || ''} صف`}</Button>}
      </>}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">الـ SKU الموجود يُحدَّث سعره وباقي بياناته، والجديد يُضاف تحت المنتج بنفس الاسم والعلامة. لا يُكتب شيء قبل ما يخلو الملف من الأخطاء.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" accept=".csv,text/csv" aria-label="ملف CSV" onChange={(e) => void pick(e.target.files?.[0])} className="max-w-full text-sm" />
          <Button small onClick={() => downloadCsv('catalog-template.csv', IMPORT_COLUMNS.map((c) => c.ar), [['كفر شفاف', 'إكسسوارات', 'Generic', 'CASE-001', '', 'أسود', '', 'جديد', '50', '40', '30', '5', '0']])}>تحميل ملف نموذجي</Button>
        </div>
        <ErrorText error={err} />
        {fileName && !res && !err && <p className="text-muted">جارٍ فحص {fileName}…</p>}
        {res && !res.applied && errCount === 0 && <p role="status" className="rounded-xl border border-ok/30 bg-ok/10 px-3 py-2 text-ok">الملف سليم: {res.rows} صف جاهز للاستيراد.</p>}
        {res?.applied && <p role="status" className="rounded-xl border border-ok/30 bg-ok/10 px-3 py-2 text-ok">تم الاستيراد: {res.created} صنف جديد و {res.updated} صنف تم تحديثه.</p>}
        {errCount > 0 && (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-danger">
            <p className="mb-1 font-semibold">{errCount} صف فيه خطأ. صحّح الملف وارفعه مرة أخرى:</p>
            <ul className="max-h-52 list-disc space-y-0.5 overflow-y-auto ps-5">
              {res!.errors.slice(0, 100).map((e, i) => <li key={i}>صف {e.row + 1}: {ERROR_AR[e.error] ?? e.error}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
