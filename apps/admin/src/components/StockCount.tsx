import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useCategories, useProducts, variantLabel } from '../lib/data'
import { formatCairo } from '../lib/time'
import { Button, Card, Chip, ErrorText, Field, inputCls } from './ui'
import { State } from './State'

type Count = { id: string; status: 'open' | 'approved' | 'cancelled'; note: string | null; started_at: string; approved_at: string | null }
type CountLine = { id: number; variant_id: string; system_qty: number; counted_qty: number | null; reason: string | null }

const REASON_AR: Record<string, string> = { damaged: 'تالف', missing: 'مفقود', stolen: 'مسروق', entry_error: 'خطأ إدخال', surplus: 'زيادة', other: 'أخرى' }

/** Stock count: start, enter counts (scan serials for tracked items), review differences, approve. Approval is irreversible. */
export default function StockCount() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canRun = hasRole('owner', 'manager', 'warehouse')
  const canApprove = hasRole('owner', 'manager')
  const products = useProducts()
  const cats = useCategories()
  const [note, setNote] = useState('')
  const [cat, setCat] = useState('')
  const [search, setSearch] = useState('')
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)

  const counts = useQuery({
    queryKey: ['stock-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_counts').select('id,status,note,started_at,approved_at').order('started_at', { ascending: false }).limit(15)
      if (error) throw error
      return data as Count[]
    },
  })
  const open = counts.data?.find((c) => c.status === 'open')
  const lines = useQuery({
    queryKey: ['stock-count-lines', open?.id],
    enabled: !!open,
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_count_lines').select('id,variant_id,system_qty,counted_qty,reason').eq('count_id', open!.id).order('id').limit(5000)
      if (error) throw error
      return data as CountLine[]
    },
  })

  const info = useMemo(() => {
    const m = new Map<string, { label: string; tracked: boolean; sku: string }>()
    for (const p of products.data ?? []) for (const v of p.variants) m.set(v.id, { label: variantLabel(p, v), tracked: p.tracking_mode !== 'none', sku: v.sku })
    return m
  }, [products.data])

  const refresh = () => ['stock-counts', 'stock-count-lines', 'stock', 'products', 'damaged'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }))
  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown; data?: unknown }>) => {
      const r = await fn()
      if (r.error) throw r.error
      return r.data
    },
    onSuccess: () => { setErr(null); refresh() },
    onError: setErr,
  })

  const rows = (lines.data ?? []).filter((l) => {
    const i = info.get(l.variant_id)
    const s = search.trim().toLowerCase()
    return (!s || (i?.label ?? '').toLowerCase().includes(s)) && (!onlyDiff || (l.counted_qty !== null && l.counted_qty !== l.system_qty))
  })
  const counted = (lines.data ?? []).filter((l) => l.counted_qty !== null)
  const diffs = counted.filter((l) => l.counted_qty !== l.system_qty)
  const missingReason = diffs.filter((l) => !l.reason).length

  async function scan(value: string) {
    const v = value.trim()
    if (!v || !open) return
    setScanMsg(null)
    const { data, error } = await supabase.rpc('scan_count_serial', { p_count: open.id, p_serial: v })
    if (error) setErr(error)
    else { setErr(null); setScanMsg(`تم تسجيل ${v.toUpperCase()} (العدد الحالي لهذا الصنف: ${String(data)})`); void qc.invalidateQueries({ queryKey: ['stock-count-lines'] }) }
    if (scanRef.current) { scanRef.current.value = ''; scanRef.current.focus() }
  }

  return (
    <div className="space-y-5">
      <ErrorText error={err} />
      {!open && canRun && (
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">بدء جرد جديد</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="القسم (اختياري)">
              <select className={inputCls} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">كل الأقسام</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </Field>
            <Field label="ملاحظة" className="sm:col-span-2"><input className={inputCls} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <p className="text-xs text-muted">الجرد بياخد صورة من الكميات الحالية. المنتجات اللي ليها سيريال بتتعد بمسح السيريالات، والباقي بإدخال الكمية الفعلية.</p>
          <Button variant="primary" disabled={run.isPending} onClick={() => run.mutate(() => supabase.rpc('start_stock_count', { p_note: note.trim() || null, p_category: cat || null }))}>بدء الجرد</Button>
        </Card>
      )}

      {open && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">جرد مفتوح</h2><Chip tone="info">{formatCairo(open.started_at)}</Chip>
            {open.note && <span className="text-sm text-muted" dir="auto">{open.note}</span>}
            <span className="ms-auto text-sm text-muted">تم عدّ {counted.length} من {lines.data?.length ?? 0} · فروق {diffs.length}</span>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <Field label="مسح سيريال / IMEI (Enter)" className="min-w-0 flex-1 sm:max-w-sm">
              <input ref={scanRef} className={inputCls} dir="ltr" autoComplete="off" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void scan(e.currentTarget.value) } }} />
            </Field>
            <input className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`} placeholder="بحث في الأصناف" aria-label="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> الفروق فقط</label>
          </div>
          {scanMsg && <p role="status" className="text-sm text-ok">{scanMsg}</p>}

          {lines.isLoading && <State kind="loading" />}
          <div className="max-h-[28rem] overflow-auto rounded-xl border border-line">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-surface text-muted"><tr className="border-b border-line">
                {['الصنف', 'بالنظام', 'المعدود', 'الفرق', 'السبب'].map((h) => <th key={h} scope="col" className="p-2 text-start font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((l) => {
                  const i = info.get(l.variant_id)
                  const d = l.counted_qty === null ? null : l.counted_qty - l.system_qty
                  return (
                    <tr key={l.id} className="border-b border-line last:border-0">
                      <td className="p-2" dir="auto">{i?.label ?? l.variant_id}{i?.tracked && <span className="text-xs text-muted"> · مسح</span>}</td>
                      <td className="p-2">{l.system_qty}</td>
                      <td className="p-2">
                        {i?.tracked ? <b>{l.counted_qty ?? '—'}</b> : (
                          <input aria-label="المعدود" className={`${inputCls} !w-20`} dir="ltr" inputMode="numeric" defaultValue={l.counted_qty ?? ''}
                            onBlur={(e) => {
                              const raw = e.target.value.trim()
                              if (raw === String(l.counted_qty ?? '')) return
                              const n = raw === '' ? null : parseInt(raw, 10)
                              if (n !== null && (Number.isNaN(n) || n < 0)) return setErr(new Error('أدخل كمية صحيحة.'))
                              run.mutate(() => supabase.rpc('save_count_line', { p_count: open.id, p_variant: l.variant_id, p_counted: n, p_reason: l.reason }))
                            }} />
                        )}
                      </td>
                      <td className={`p-2 font-semibold ${d ? (d < 0 ? 'text-danger' : 'text-warn') : ''}`}>{d === null ? '' : d > 0 ? `+${d}` : d}</td>
                      <td className="p-2">
                        {d !== null && d !== 0 && !i?.tracked && (
                          <select aria-label="السبب" className={`${inputCls} !w-32`} value={l.reason ?? ''}
                            onChange={(e) => run.mutate(() => supabase.rpc('save_count_line', { p_count: open.id, p_variant: l.variant_id, p_counted: l.counted_qty, p_reason: e.target.value || null }))}>
                            <option value="">اختر…</option>{Object.entries(REASON_AR).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                          </select>
                        )}
                        {d !== null && d !== 0 && i?.tracked && <span className="text-xs text-muted">الأجهزة غير الممسوحة تُسجَّل مفقودة</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {canApprove && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={run.isPending || counted.length === 0 || missingReason > 0}
                onClick={() => confirm(`اعتماد الجرد؟ سيتم تعديل ${diffs.length} صنف ولا يمكن التراجع (التصحيح بجرد جديد).`) && run.mutate(() => supabase.rpc('approve_stock_count', { p_count: open.id }))}>اعتماد الجرد</Button>
              <Button variant="danger" disabled={run.isPending} onClick={() => confirm('إلغاء الجرد المفتوح؟') && run.mutate(() => supabase.rpc('cancel_stock_count', { p_count: open.id }))}>إلغاء الجرد</Button>
              {missingReason > 0 && <span className="text-sm text-warn">{missingReason} فرق محتاج سبب قبل الاعتماد (الأجهزة بسيريال تأخذ سبب «مفقود» تلقائيًا بعد اختياره من الصنف).</span>}
            </div>
          )}
        </Card>
      )}

      <section>
        <h2 className="mb-2 font-semibold">آخر الجرد</h2>
        {counts.data?.filter((c) => c.status !== 'open').length === 0 && <State kind="empty" title="لا يوجد جرد سابق" />}
        <ul className="space-y-1.5 text-sm">
          {counts.data?.filter((c) => c.status !== 'open').map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2">
              <Chip tone={c.status === 'approved' ? 'ok' : 'neutral'}>{c.status === 'approved' ? 'معتمد' : 'ملغي'}</Chip>
              <span>{formatCairo(c.started_at)}</span>{c.note && <span className="text-muted" dir="auto">{c.note}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
