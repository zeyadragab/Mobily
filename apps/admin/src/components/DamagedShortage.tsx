import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useProducts, variantLabel } from '../lib/data'
import { formatCairo } from '../lib/time'
import { downloadCsv } from '../lib/repairs'
import { Button, Card, Chip, ErrorText, Field, inputCls } from './ui'
import { State } from './State'

type Damaged = { id: string; variant_id: string; qty: number; reason: string; source: string; return_to_supplier: boolean; supplier_id: string | null; returned_at: string | null; created_at: string }
type Shortage = { id: string; name: string; note: string | null; created_at: string; resolved_at: string | null }

/** Damaged goods (written off with a reason, optionally to be returned to the supplier) and the shortage book. */
export function DamagedTab() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canRun = hasRole('owner', 'manager', 'warehouse')
  const products = useProducts()
  const [variant, setVariant] = useState('')
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [ret, setRet] = useState(false)
  const [supplier, setSupplier] = useState('')
  const [err, setErr] = useState<unknown>(null)

  const labels = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of products.data ?? []) for (const v of p.variants) m.set(v.id, variantLabel(p, v))
    return m
  }, [products.data])
  const options = useMemo(() => (products.data ?? []).filter((p) => p.tracking_mode === 'none' && p.is_active).flatMap((p) => p.variants.filter((v) => v.is_active).map((v) => ({ id: v.id, label: variantLabel(p, v) }))), [products.data])

  const rows = useQuery({
    queryKey: ['damaged'],
    queryFn: async () => {
      const { data, error } = await supabase.from('damaged_items').select('*').order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      return data as Damaged[]
    },
  })
  const suppliers = useQuery({
    queryKey: ['suppliers', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('id,name').eq('status', 'active').order('name')
      if (error) throw error
      return data as { id: string; name: string }[]
    },
  })
  const refresh = () => ['damaged', 'stock', 'products'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }))
  const add = useMutation({
    mutationFn: async () => {
      const n = parseInt(qty, 10)
      if (!variant) throw new Error('اختر الصنف.')
      if (!n || n <= 0) throw new Error('الكمية غير صحيحة.')
      if (!reason.trim()) throw new Error('اكتب سبب التلف.')
      if (ret && !supplier) throw new Error('اختر المورد للإرجاع.')
      const { error } = await supabase.rpc('record_damage', { p_variant: variant, p_qty: n, p_reason: reason.trim(), p_return: ret, p_supplier: ret ? supplier : null })
      if (error) throw error
    },
    onSuccess: () => { setErr(null); setQty('1'); setReason(''); setRet(false); refresh() },
    onError: setErr,
  })
  const returned = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc('mark_damage_returned', { p_id: id }); if (error) throw error },
    onSuccess: refresh, onError: setErr,
  })

  return (
    <div className="space-y-5">
      <ErrorText error={err} />
      {canRun && (
        <Card className="grid gap-3 p-5 sm:grid-cols-4">
          <Field label="الصنف" className="sm:col-span-2">
            <select className={inputCls} value={variant} onChange={(e) => setVariant(e.target.value)}><option value="">اختر…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
          </Field>
          <Field label="الكمية"><input className={inputCls} dir="ltr" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="السبب *"><input className={inputCls} dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={ret} onChange={(e) => setRet(e.target.checked)} /> هيتم إرجاعه للمورد</label>
          {ret && <Field label="المورد"><select className={inputCls} value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">اختر…</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
          <div className="flex items-end sm:col-span-4"><Button variant="primary" disabled={add.isPending} onClick={() => { setErr(null); add.mutate() }}>تسجيل التالف</Button></div>
          <p className="text-xs text-muted sm:col-span-4">الأجهزة بسيريال بتتشطب من صفحة الأجهزة. هنا الأصناف العادية بس، والكمية بتنزل من المخزون فورًا.</p>
        </Card>
      )}
      {rows.isLoading && <State kind="loading" />}
      {rows.data?.length === 0 && <State kind="empty" title="لا يوجد تالف مسجل" />}
      {rows.data && rows.data.length > 0 && (
        <Card className="overflow-x-auto">
          <div className="flex justify-end p-2"><Button small onClick={() => downloadCsv('damaged.csv', ['الصنف', 'الكمية', 'السبب', 'المصدر', 'التاريخ'], rows.data.map((r) => [labels.get(r.variant_id) ?? '', r.qty, r.reason, r.source === 'count' ? 'جرد' : 'يدوي', formatCairo(r.created_at)]))}>تصدير CSV</Button></div>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-muted"><tr className="border-b border-line">{['الصنف', 'الكمية', 'السبب', 'التاريخ', 'الإرجاع'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows.data.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="p-3" dir="auto">{labels.get(r.variant_id) ?? '—'}</td><td className="p-3">{r.qty}</td>
                  <td className="p-3" dir="auto">{r.reason}{r.source === 'count' && <Chip tone="info">من جرد</Chip>}</td>
                  <td className="whitespace-nowrap p-3">{formatCairo(r.created_at)}</td>
                  <td className="p-3">{!r.return_to_supplier ? '—' : r.returned_at ? <Chip tone="ok">رجع للمورد</Chip> : canRun ? <Button small onClick={() => returned.mutate(r.id)}>تم الإرجاع</Button> : <Chip tone="warn">منتظر</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

export function ShortageTab() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canEdit = hasRole('owner', 'manager', 'warehouse')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const rows = useQuery({
    queryKey: ['shortage'],
    queryFn: async () => {
      const { data, error } = await supabase.from('shortage_book').select('id,name,note,created_at,resolved_at').order('created_at', { ascending: false }).limit(300)
      if (error) throw error
      return data as Shortage[]
    },
  })
  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => { const { error } = await fn(); if (error) throw error },
    onSuccess: () => { setErr(null); void qc.invalidateQueries({ queryKey: ['shortage'] }) },
    onError: setErr,
  })
  const shown = (rows.data ?? []).filter((r) => showDone || !r.resolved_at)
  return (
    <div className="space-y-4">
      <ErrorText error={err} />
      <Card className="flex flex-wrap items-end gap-2 p-4">
        <Field label="الصنف الناقص" className="min-w-0 flex-1"><input className={inputCls} dir="auto" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="ملاحظة" className="min-w-0 flex-1"><input className={inputCls} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button variant="primary" disabled={!name.trim() || run.isPending} onClick={() => run.mutate(async () => {
          const r = await supabase.from('shortage_book').insert({ name: name.trim(), note: note.trim() || null })
          if (!r.error) { setName(''); setNote('') }
          return r
        })}>+ إضافة</Button>
      </Card>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> إظهار المنتهي</label>
      {shown.length === 0 && <State kind="empty" title="دفتر النواقص فاضي" text="سجّل هنا أي صنف العميل سأل عنه ومش موجود." />}
      <ul className="space-y-1.5">
        {shown.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
            <span className={r.resolved_at ? 'text-muted line-through' : 'font-medium'} dir="auto">{r.name}</span>
            {r.note && <span className="text-muted" dir="auto">{r.note}</span>}
            <span className="ms-auto text-xs text-muted">{formatCairo(r.created_at)}</span>
            {canEdit && !r.resolved_at && <Button small onClick={() => run.mutate(() => supabase.from('shortage_book').update({ resolved_at: new Date().toISOString() }).eq('id', r.id))}>تم التوفير</Button>}
            {canEdit && <Button small variant="danger" onClick={() => run.mutate(() => supabase.from('shortage_book').delete().eq('id', r.id))}>حذف</Button>}
          </li>
        ))}
      </ul>
    </div>
  )
}
