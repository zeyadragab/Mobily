import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { CAN_EDIT_CATALOG, CAN_SEE_COST } from '../lib/roles'
import { CONDITION_AR, useCategories, useCosts, useProducts, useStock, type Product } from '../lib/data'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { State } from '../components/State'

type VRow = {
  id?: string
  sku: string
  barcode: string
  color: string
  storage: string
  condition: 'new' | 'used' | 'refurbished'
  price: string
  cost: string
  reorder_level: string
  warranty_months: string
  is_active: boolean
}
type Form = {
  id?: string
  name: string
  category_id: string
  brand: string
  description: string
  image_url: string
  track_serial: boolean
  is_published: boolean
  is_active: boolean
  variants: VRow[]
}

const emptyVariant = (): VRow => ({
  sku: '', barcode: '', color: '', storage: '', condition: 'new',
  price: '', cost: '', reorder_level: '0', warranty_months: '0', is_active: true,
})
const emptyForm = (): Form => ({
  name: '', category_id: '', brand: '', description: '', image_url: '',
  track_serial: false, is_published: false, is_active: true,
  variants: [emptyVariant()],
})

export default function Products() {
  const { hasRole } = useAuth()
  const canEdit = hasRole(...CAN_EDIT_CATALOG)
  const canCost = hasRole(...CAN_SEE_COST)
  const canEditCost = hasRole('owner', 'manager')
  const qc = useQueryClient()

  const products = useProducts()
  const cats = useCategories()
  const stock = useStock()
  const costs = useCosts(canCost)

  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const [editing, setEditing] = useState<Form | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (products.data ?? []).filter(
      (p) =>
        (!cat || p.category_id === cat) &&
        (!s ||
          p.name.toLowerCase().includes(s) ||
          (p.brand ?? '').toLowerCase().includes(s) ||
          p.variants.some((v) => v.sku.toLowerCase().includes(s) || (v.barcode ?? '').includes(s))),
    )
  }, [products.data, search, cat])

  function open(p?: Product) {
    setFormError(null)
    if (!p) return setEditing(emptyForm())
    setEditing({
      id: p.id,
      name: p.name,
      category_id: p.category_id ?? '',
      brand: p.brand ?? '',
      description: p.description ?? '',
      image_url: p.image_url ?? '',
      track_serial: p.track_serial,
      is_published: p.is_published,
      is_active: p.is_active,
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode ?? '',
        color: v.color ?? '',
        storage: v.storage ?? '',
        condition: v.condition,
        price: v.price,
        cost: costs.data?.get(v.id) ?? '',
        reorder_level: String(v.reorder_level),
        warranty_months: String(v.warranty_months ?? 0),
        is_active: v.is_active,
      })),
    })
  }

  const save = useMutation({
    mutationFn: async (f: Form) => {
      if (!f.name.trim()) throw new Error('اسم المنتج مطلوب.')
      if (f.image_url.trim() && !/^https:\/\//i.test(f.image_url.trim())) throw new Error('رابط الصورة يجب أن يبدأ بـ https://')
      if (f.variants.length === 0) throw new Error('أضف متغيرًا واحدًا على الأقل.')
      const skus = new Set<string>()
      for (const v of f.variants) {
        if (!v.sku.trim()) throw new Error('رمز الصنف (SKU) مطلوب لكل متغير.')
        if (skus.has(v.sku.trim().toLowerCase())) throw new Error('رمز الصنف مكرر داخل نفس المنتج.')
        skus.add(v.sku.trim().toLowerCase())
        try { toMinor(v.price || '0'); if (v.cost) toMinor(v.cost) } catch { throw new Error('السعر والتكلفة أرقام بحد أقصى خانتين عشريتين.') }
      }
      const base = {
        name: f.name.trim(),
        category_id: f.category_id || null,
        brand: f.brand.trim() || null,
        description: f.description.trim() || null,
        image_url: f.image_url.trim() || null,
        track_serial: f.track_serial,
        is_published: f.is_published,
        is_active: f.is_active,
      }
      let pid = f.id
      if (pid) {
        const { error } = await supabase.from('products').update(base).eq('id', pid)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('products').insert(base).select('id').single()
        if (error) throw error
        pid = data.id as string
      }
      for (const v of f.variants) {
        const row = {
          product_id: pid,
          sku: v.sku.trim(),
          barcode: v.barcode.trim() || null,
          color: v.color.trim() || null,
          storage: v.storage.trim() || null,
          condition: v.condition,
          price: fromMinor(toMinor(v.price || '0')),
          reorder_level: Math.max(0, parseInt(v.reorder_level || '0', 10) || 0),
          warranty_months: Math.max(0, parseInt(v.warranty_months || '0', 10) || 0),
          is_active: v.is_active,
        }
        let vid = v.id
        if (vid) {
          const { error } = await supabase.from('variants').update(row).eq('id', vid)
          if (error) throw error
        } else {
          const { data, error } = await supabase.from('variants').insert(row).select('id').single()
          if (error) throw error
          vid = data.id as string
        }
        if (canEditCost && v.cost !== '') {
          const { error } = await supabase
            .from('variant_costs')
            .upsert({ variant_id: vid, cost: fromMinor(toMinor(v.cost)), updated_at: new Date().toISOString() })
          if (error) throw error
        }
      }
    },
    onSuccess: () => {
      setEditing(null)
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['costs'] })
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'تعذّر الحفظ'),
  })

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      setEditing(null)
      qc.invalidateQueries({ queryKey: ['products'] })
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'تعذّر الحذف'),
  })

  const set = (patch: Partial<Form>) => setEditing((f) => (f ? { ...f, ...patch } : f))
  const setV = (i: number, patch: Partial<VRow>) =>
    setEditing((f) => (f ? { ...f, variants: f.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) } : f))

  return (
    <div>
      <PageHeader
        title="المنتجات"
        subtitle="الأصناف والمتغيرات (اللون والسعة والحالة) والأسعار."
        actions={canEdit && <Button variant="primary" onClick={() => open()}>+ منتج جديد</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className={`${inputCls} min-w-0 flex-1 sm:max-w-sm`}
          placeholder="بحث بالاسم أو العلامة أو SKU أو الباركود"
          aria-label="بحث"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={`${inputCls} sm:w-48`} aria-label="القسم" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">كل الأقسام</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {products.isLoading && <State kind="loading" />}
      {products.isError && <State kind="error" text="تعذّر تحميل المنتجات." />}
      {products.data && rows.length === 0 && (
        <State
          kind="empty"
          title={products.data.length === 0 ? 'لا توجد منتجات بعد' : 'لا توجد نتائج'}
          text={products.data.length === 0 && canEdit ? 'ابدأ بإضافة أول منتج.' : undefined}
          action={products.data.length === 0 && canEdit ? <Button variant="primary" onClick={() => open()}>+ منتج جديد</Button> : undefined}
        />
      )}

      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr className="border-b border-line">
                {['المنتج', 'القسم', 'المتغيرات', 'السعر', 'المتاح', 'الحالة'].map((h) => (
                  <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const prices = p.variants.map((v) => toMinor(v.price))
                const onHand = p.variants.reduce((s, v) => s + (stock.data?.get(v.id) ?? 0), 0)
                const low = p.variants.some((v) => v.reorder_level > 0 && (stock.data?.get(v.id) ?? 0) <= v.reorder_level)
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-line last:border-0 ${canEdit ? 'cursor-pointer hover:bg-bg' : ''}`}
                    onClick={() => canEdit && open(p)}
                  >
                    <td className="p-3">
                      <p className="font-medium" dir="auto">{p.name}</p>
                      {p.brand && <p className="text-xs text-muted">{p.brand}</p>}
                    </td>
                    <td className="p-3">{p.categories?.name ?? '—'}</td>
                    <td className="p-3">{p.variants.length}</td>
                    <td className="whitespace-nowrap p-3">
                      {prices.length === 0 ? '—' : Math.min(...prices) === Math.max(...prices)
                        ? formatEGP(prices[0])
                        : `${formatEGP(Math.min(...prices))} – ${formatEGP(Math.max(...prices))}`}
                    </td>
                    <td className="p-3">
                      <span className="font-semibold">{onHand}</span>{' '}
                      {low && <Chip tone="warn">قرب ينتهي</Chip>}
                    </td>
                    <td className="space-x-1 space-x-reverse p-3">
                      {!p.is_active ? <Chip>موقوف</Chip> : p.is_published ? <Chip tone="ok">منشور</Chip> : <Chip tone="info">مسودة</Chip>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        wide
        title={editing?.id ? 'تعديل منتج' : 'منتج جديد'}
        footer={
          editing && (
            <>
              {editing.id && (
                <Button
                  variant="danger"
                  className="me-auto"
                  disabled={del.isPending}
                  onClick={() => confirm('حذف المنتج نهائيًا؟ لن يتم الحذف لو له حركات مخزون.') && del.mutate(editing.id!)}
                >
                  حذف
                </Button>
              )}
              <Button onClick={() => setEditing(null)}>إلغاء</Button>
              <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(editing)}>
                {save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}
              </Button>
            </>
          )
        }
      >
        {editing && (
          <div className="space-y-5">
            {formError && <ErrorText error={new Error(formError)} />}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="اسم المنتج *">
                <input className={inputCls} value={editing.name} onChange={(e) => set({ name: e.target.value })} dir="auto" />
              </Field>
              <Field label="القسم">
                <select className={inputCls} value={editing.category_id} onChange={(e) => set({ category_id: e.target.value })}>
                  <option value="">— بدون —</option>
                  {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="العلامة التجارية">
                <input className={inputCls} value={editing.brand} onChange={(e) => set({ brand: e.target.value })} dir="auto" />
              </Field>
              <Field label="رابط الصورة (https)" className="sm:col-span-2">
                <input className={inputCls} dir="ltr" placeholder="https://…" value={editing.image_url} onChange={(e) => set({ image_url: e.target.value })} />
              </Field>
              <Field label="الوصف" className="sm:col-span-2">
                <textarea className={inputCls} rows={2} value={editing.description} onChange={(e) => set({ description: e.target.value })} dir="auto" />
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {([
                ['track_serial', 'تتبع بالسيريال/IMEI'],
                ['is_published', 'منشور على الموقع'],
                ['is_active', 'نشط'],
              ] as const).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" checked={editing[k]} onChange={(e) => set({ [k]: e.target.checked })} /> {l}
                </label>
              ))}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">المتغيرات</h3>
                <Button small onClick={() => set({ variants: [...editing.variants, emptyVariant()] })}>+ متغير</Button>
              </div>
              <div className="space-y-3">
                {editing.variants.map((v, i) => (
                  <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-4">
                    <Field label="SKU *"><input className={inputCls} dir="ltr" value={v.sku} onChange={(e) => setV(i, { sku: e.target.value })} /></Field>
                    <Field label="الباركود"><input className={inputCls} dir="ltr" value={v.barcode} onChange={(e) => setV(i, { barcode: e.target.value })} /></Field>
                    <Field label="اللون"><input className={inputCls} dir="auto" value={v.color} onChange={(e) => setV(i, { color: e.target.value })} /></Field>
                    <Field label="السعة / المقاس"><input className={inputCls} dir="auto" value={v.storage} onChange={(e) => setV(i, { storage: e.target.value })} /></Field>
                    <Field label="الحالة">
                      <select className={inputCls} value={v.condition} onChange={(e) => setV(i, { condition: e.target.value as VRow['condition'] })}>
                        {Object.entries(CONDITION_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </Field>
                    <Field label="سعر البيع *"><input className={inputCls} inputMode="decimal" dir="ltr" value={v.price} onChange={(e) => setV(i, { price: e.target.value })} /></Field>
                    {canCost && (
                      <Field label="التكلفة" hint={canEditCost ? undefined : 'للعرض فقط'}>
                        <input className={inputCls} inputMode="decimal" dir="ltr" value={v.cost} disabled={!canEditCost} onChange={(e) => setV(i, { cost: e.target.value })} />
                      </Field>
                    )}
                    <Field label="الضمان (شهور)"><input className={inputCls} inputMode="numeric" dir="ltr" value={v.warranty_months} onChange={(e) => setV(i, { warranty_months: e.target.value })} /></Field>
                    <Field label="حد إعادة الطلب"><input className={inputCls} inputMode="numeric" dir="ltr" value={v.reorder_level} onChange={(e) => setV(i, { reorder_level: e.target.value })} /></Field>
                    <div className="flex items-end justify-between gap-2 sm:col-span-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={v.is_active} onChange={(e) => setV(i, { is_active: e.target.checked })} /> نشط
                      </label>
                      {!v.id && editing.variants.length > 1 && (
                        <Button small variant="danger" onClick={() => set({ variants: editing.variants.filter((_, j) => j !== i) })}>إزالة</Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
