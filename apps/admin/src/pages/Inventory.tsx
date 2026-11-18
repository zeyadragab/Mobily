import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { CAN_SEE_COST, CAN_STOCK } from '../lib/roles'
import { useBranches, useCosts, useProducts, useStock, variantLabel } from '../lib/data'
import { formatEGP, toMinor } from '../lib/money'
import { formatCairo } from '../lib/time'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { State } from '../components/State'

const MOVE_AR: Record<string, string> = {
  purchase_receipt: 'استلام شراء', sale: 'بيع', return: 'مرتجع', adjustment: 'تسوية',
  transfer_in: 'تحويل وارد', transfer_out: 'تحويل صادر', count_adjustment: 'تسوية جرد',
}

export default function Inventory() {
  const { hasRole } = useAuth()
  const canAdjust = hasRole(...CAN_STOCK)
  const canCost = hasRole(...CAN_SEE_COST)
  const qc = useQueryClient()

  const branches = useBranches()
  const branch = branches.data?.[0]
  const products = useProducts()
  const stock = useStock(branch?.id)
  const costs = useCosts(canCost)

  const [tab, setTab] = useState<'levels' | 'moves' | 'returns'>('levels')
  const [search, setSearch] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [adj, setAdj] = useState<{ variant_id: string; delta: string; reason: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const lines = useMemo(() => {
    const out: { id: string; label: string; sku: string; reorder: number; onHand: number; cost?: string; active: boolean }[] = []
    for (const p of products.data ?? []) {
      for (const v of p.variants) {
        out.push({
          id: v.id, label: variantLabel(p, v), sku: v.sku, reorder: v.reorder_level,
          onHand: stock.data?.get(v.id) ?? 0, cost: costs.data?.get(v.id), active: v.is_active && p.is_active,
        })
      }
    }
    const s = search.trim().toLowerCase()
    return out.filter((l) => (!s || l.label.toLowerCase().includes(s)) && (!onlyLow || (l.reorder > 0 && l.onHand <= l.reorder)))
  }, [products.data, stock.data, costs.data, search, onlyLow])

  const totals = useMemo(() => {
    let units = 0, value = 0
    for (const l of lines) {
      units += l.onHand
      if (l.cost) value += l.onHand * toMinor(l.cost)
    }
    return { units, value }
  }, [lines])

  const moves = useQuery({
    queryKey: ['movements'],
    enabled: tab === 'moves',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_movements')
        .select('id,variant_id,movement_type,qty,note,created_at,created_by')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return data as { id: number; variant_id: string; movement_type: string; qty: number; note: string | null; created_at: string }[]
    },
  })
  const nameOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of products.data ?? []) for (const v of p.variants) m.set(v.id, variantLabel(p, v))
    return m
  }, [products.data])

  const inspection = useQuery({
    queryKey: ['inspection'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_return_lines')
        .select('id,name_snapshot,qty,return_id,sales_returns!inner(return_number,created_at,status)')
        .eq('disposition', 'inspection')
        .eq('sales_returns.status', 'completed')
      if (error) throw error
      return data as unknown as { id: string; name_snapshot: string; qty: number; sales_returns: { return_number: string; created_at: string } }[]
    },
  })
  const resolve = useMutation({
    mutationFn: async (v: { id: string; result: 'sellable' | 'damaged' }) => {
      const { error } = await supabase.rpc('resolve_return_line', { p_line: v.id, p_result: v.result })
      if (error) throw error
    },
    onSuccess: () => {
      ;['inspection', 'stock', 'movements', 'transactions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
    },
  })

  const adjust = useMutation({
    mutationFn: async (a: NonNullable<typeof adj>) => {
      const delta = parseInt(a.delta, 10)
      if (!a.variant_id) throw new Error('اختر الصنف.')
      if (!delta) throw new Error('أدخل كمية موجبة للزيادة أو سالبة للنقص.')
      if (!a.reason.trim()) throw new Error('سبب التسوية مطلوب.')
      if (!branch) throw new Error('لا يوجد فرع.')
      const { error } = await supabase.rpc('adjust_stock', {
        p_variant: a.variant_id, p_branch: branch.id, p_delta: delta, p_reason: a.reason.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      setAdj(null)
      qc.invalidateQueries({ queryKey: ['stock'] })
      qc.invalidateQueries({ queryKey: ['movements'] })
    },
    onError: (e) => setErr(e instanceof Error ? e.message : (e as { message: string }).message),
  })

  return (
    <div>
      <PageHeader
        title="المخزون"
        subtitle={branch ? `الفرع: ${branch.name}` : undefined}
        actions={canAdjust && <Button variant="primary" onClick={() => { setErr(null); setAdj({ variant_id: '', delta: '', reason: '' }) }}>تسوية مخزون</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted">إجمالي الوحدات</p><p className="mt-1 text-2xl font-bold">{totals.units}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted">عدد الأصناف</p><p className="mt-1 text-2xl font-bold">{lines.length}</p></Card>
        {canCost && <Card className="p-4"><p className="text-xs text-muted">قيمة المخزون بالتكلفة</p><p className="mt-1 text-2xl font-bold">{formatEGP(totals.value)}</p></Card>}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="tablist">
          {([['levels', 'الأرصدة'], ['moves', 'الحركات'], ['returns', `مرتجعات تحت الفحص${inspection.data?.length ? ` (${inspection.data.length})` : ''}`]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-2 text-sm ${tab === k ? 'btn-gel' : 'border border-line'}`}>{l}</button>
          ))}
        </div>
        {tab === 'levels' && (
          <>
            <input className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`} placeholder="بحث بالاسم أو SKU" aria-label="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> قرب ينتهي فقط</label>
          </>
        )}
      </div>

      {(products.isLoading || stock.isLoading) && <State kind="loading" />}
      {(products.isError || stock.isError) && <State kind="error" text="تعذّر تحميل المخزون." />}

      {tab === 'levels' && products.data && lines.length === 0 && <State kind="empty" title="لا توجد أصناف" text="أضف منتجات أولًا من صفحة المنتجات." />}
      {tab === 'levels' && lines.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted"><tr className="border-b border-line">
              {['الصنف', 'المتاح', 'حد الطلب', ...(canCost ? ['التكلفة', 'القيمة'] : []), 'الحالة'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="p-3" dir="auto">{l.label}</td>
                  <td className="p-3 font-semibold">{l.onHand}</td>
                  <td className="p-3">{l.reorder || '—'}</td>
                  {canCost && <td className="p-3">{l.cost ? formatEGP(toMinor(l.cost)) : '—'}</td>}
                  {canCost && <td className="p-3">{l.cost ? formatEGP(l.onHand * toMinor(l.cost)) : '—'}</td>}
                  <td className="p-3">
                    {!l.active ? <Chip>موقوف</Chip> : l.onHand === 0 ? <Chip tone="danger">نفد</Chip>
                      : l.reorder > 0 && l.onHand <= l.reorder ? <Chip tone="warn">قرب ينتهي</Chip> : <Chip tone="ok">متوفر</Chip>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'moves' && moves.isLoading && <State kind="loading" />}
      {tab === 'moves' && moves.data?.length === 0 && <State kind="empty" title="لا توجد حركات بعد" />}
      {tab === 'moves' && moves.data && moves.data.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted"><tr className="border-b border-line">
              {['الوقت', 'الصنف', 'النوع', 'الكمية', 'ملاحظة'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {moves.data.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap p-3">{formatCairo(m.created_at)}</td>
                  <td className="p-3" dir="auto">{nameOf.get(m.variant_id) ?? m.variant_id.slice(0, 8)}</td>
                  <td className="p-3">{MOVE_AR[m.movement_type] ?? m.movement_type}</td>
                  <td className={`p-3 font-semibold ${m.qty > 0 ? 'text-ok' : 'text-danger'}`} dir="ltr">{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                  <td className="p-3">{m.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'returns' && (
        <div className="space-y-3">
          <p className="text-sm text-muted">القطع المرتجعة لا تعود للبيع قبل فحصها. اختر "صالح للبيع" لإعادتها للمخزون أو "تالف" لاستبعادها.</p>
          <ErrorText error={resolve.error} />
          {inspection.isLoading && <State kind="loading" />}
          {inspection.data?.length === 0 && <State kind="empty" title="لا توجد قطع بانتظار الفحص" />}
          {inspection.data && inspection.data.length > 0 && (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted"><tr className="border-b border-line">
                  {['المرتجع', 'الصنف', 'الكمية', 'التاريخ', ...(canAdjust ? ['القرار'] : [])].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
                </tr></thead>
                <tbody>
                  {inspection.data.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="p-3 font-mono text-xs" dir="ltr">{r.sales_returns?.return_number}</td>
                      <td className="p-3" dir="auto">{r.name_snapshot}</td>
                      <td className="p-3 font-semibold">{r.qty}</td>
                      <td className="whitespace-nowrap p-3">{r.sales_returns ? formatCairo(r.sales_returns.created_at) : '—'}</td>
                      {canAdjust && (
                        <td className="space-x-2 space-x-reverse p-3">
                          <Button small variant="primary" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, result: 'sellable' })}>صالح للبيع</Button>
                          <Button small variant="danger" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, result: 'damaged' })}>تالف</Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      <Modal open={!!adj} onClose={() => setAdj(null)} title="تسوية مخزون"
        footer={adj && <><Button onClick={() => setAdj(null)}>إلغاء</Button>
          <Button variant="primary" disabled={adjust.isPending} onClick={() => adjust.mutate(adj)}>{adjust.isPending ? 'جارٍ الحفظ…' : 'تسجيل'}</Button></>}>
        {adj && (
          <div className="space-y-3">
            {err && <ErrorText error={new Error(err)} />}
            <Field label="الصنف *">
              <select className={inputCls} value={adj.variant_id} onChange={(e) => setAdj({ ...adj, variant_id: e.target.value })}>
                <option value="">— اختر —</option>
                {lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </Field>
            <Field label="الكمية (+ زيادة / - نقص) *" hint="مثال: 5 أو -2">
              <input className={inputCls} dir="ltr" inputMode="numeric" value={adj.delta} onChange={(e) => setAdj({ ...adj, delta: e.target.value })} />
            </Field>
            <Field label="السبب *"><input className={inputCls} dir="auto" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} /></Field>
            <p className="text-xs text-muted">تُسجَّل التسوية في سجل الحركات باسمك ولا يمكن تعديلها.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
