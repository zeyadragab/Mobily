import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useCategories, useProducts, variantLabel } from '../lib/data'
import { OFFER_KIND, offerOpen, useOffers, type Offer, type OfferKind } from '../lib/offers'
import { formatEGP, toMinor } from '../lib/money'
import { cairoBusinessDate } from '../lib/time'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { State } from '../components/State'

type Form = {
  id?: string; name: string; kind: OfferKind; value: string; cap: string; variant_id: string; category_id: string
  buy_qty: string; get_qty: string; starts_on: string; ends_on: string; max_uses: string; is_active: boolean
  items: { variant_id: string; qty: string }[]
}
const empty = (): Form => ({ name: '', kind: 'percent', value: '', cap: '', variant_id: '', category_id: '', buy_qty: '2', get_qty: '1', starts_on: '', ends_on: '', max_uses: '', is_active: true, items: [{ variant_id: '', qty: '1' }] })

function describe(o: Offer) {
  if (o.kind === 'percent') return `${Number(o.value)}%${o.cap ? ` (حتى ${formatEGP(toMinor(o.cap))})` : ''}`
  if (o.kind === 'fixed') return formatEGP(toMinor(o.value))
  if (o.kind === 'bxgy') return `اشتري ${o.buy_qty} وخذ ${o.get_qty} مجانًا`
  return `باقة بسعر ${formatEGP(toMinor(o.value))}`
}

export default function Offers() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canEdit = hasRole('owner', 'manager')
  const offers = useOffers()
  const products = useProducts()
  const cats = useCategories()
  const [f, setF] = useState<Form | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const today = cairoBusinessDate()

  const variants = (products.data ?? []).flatMap((p) => p.variants.filter((v) => v.is_active).map((v) => ({ id: v.id, label: variantLabel(p, v) })))
  const label = (id: string | null) => variants.find((v) => v.id === id)?.label ?? ''

  function open(o?: Offer) {
    setErr(null)
    setF(o ? {
      id: o.id, name: o.name, kind: o.kind, value: o.value, cap: o.cap ?? '', variant_id: o.variant_id ?? '', category_id: o.category_id ?? '',
      buy_qty: String(o.buy_qty ?? 2), get_qty: String(o.get_qty ?? 1), starts_on: o.starts_on ?? '', ends_on: o.ends_on ?? '', max_uses: o.max_uses ? String(o.max_uses) : '',
      is_active: o.is_active, items: o.offer_items.length ? o.offer_items.map((i) => ({ variant_id: i.variant_id, qty: String(i.qty) })) : [{ variant_id: '', qty: '1' }],
    } : empty())
  }

  const save = useMutation({
    mutationFn: async (x: Form) => {
      if (!x.name.trim()) throw new Error('اسم العرض مطلوب.')
      let value = 0
      try { value = Number(x.value || '0'); toMinor(x.value || '0') } catch { throw new Error('القيمة غير صحيحة.') }
      if (x.kind === 'percent' && (value <= 0 || value > 100)) throw new Error('النسبة بين 0 و 100.')
      if (x.kind === 'fixed' && value <= 0) throw new Error('اكتب مبلغ الخصم.')
      if (x.kind === 'bxgy' && !x.variant_id) throw new Error('اختر الصنف.')
      const items = x.items.filter((i) => i.variant_id)
      if (x.kind === 'bundle' && (items.length < 2 || value <= 0)) throw new Error('الباقة لازم فيها صنفين على الأقل وسعر.')
      const row = {
        name: x.name.trim(), kind: x.kind, value,
        cap: x.kind === 'percent' && x.cap ? Number(x.cap) : null,
        variant_id: (x.kind === 'bxgy' || x.kind === 'percent') && x.variant_id ? x.variant_id : null,
        category_id: x.kind === 'percent' && x.category_id ? x.category_id : null,
        buy_qty: x.kind === 'bxgy' ? parseInt(x.buy_qty, 10) || 1 : null, get_qty: x.kind === 'bxgy' ? parseInt(x.get_qty, 10) || 1 : null,
        starts_on: x.starts_on || null, ends_on: x.ends_on || null, max_uses: x.max_uses ? parseInt(x.max_uses, 10) : null, is_active: x.is_active,
      }
      let id = x.id
      if (id) { const { error } = await supabase.from('offers').update(row).eq('id', id); if (error) throw error }
      else { const { data, error } = await supabase.from('offers').insert(row).select('id').single(); if (error) throw error; id = data.id as string }
      if (x.kind === 'bundle') {
        const { error: de } = await supabase.from('offer_items').delete().eq('offer_id', id); if (de) throw de
        const { error: ie } = await supabase.from('offer_items').insert(items.map((i) => ({ offer_id: id, variant_id: i.variant_id, qty: parseInt(i.qty, 10) || 1 })))
        if (ie) throw ie
      }
    },
    onSuccess: () => { setF(null); void qc.invalidateQueries({ queryKey: ['offers'] }) },
    onError: setErr,
  })
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('offers').delete().eq('id', id); if (error) throw error },
    onSuccess: () => { setF(null); void qc.invalidateQueries({ queryKey: ['offers'] }) },
    onError: setErr,
  })
  const set = (p: Partial<Form>) => setF((x) => (x ? { ...x, ...p } : x))

  return (
    <div>
      <PageHeader title="العروض والباقات" subtitle="خصم بنسبة أو مبلغ أو «اشتري وخذ» أو باقة بسعر واحد. الكاشير يختار العرض في الفاتورة والنظام يحسبه." actions={canEdit && <Button variant="primary" onClick={() => open()}>+ عرض جديد</Button>} />
      {offers.isLoading && <State kind="loading" />}
      {offers.data?.length === 0 && <State kind="empty" title="لا توجد عروض" text={canEdit ? 'أضف أول عرض.' : undefined} />}
      <div className="stagger grid gap-3 sm:grid-cols-2">
        {offers.data?.map((o) => (
          <Card key={o.id} className={`p-4 ${canEdit ? 'cursor-pointer hover:bg-bg' : ''}`}>
            <button type="button" className="w-full text-start" disabled={!canEdit} onClick={() => open(o)}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold" dir="auto">{o.name}</p>
                {offerOpen(o, today) ? <Chip tone="ok">ساري</Chip> : <Chip>غير ساري</Chip>}
              </div>
              <p className="mt-1 text-sm">{OFFER_KIND[o.kind]} · {describe(o)}</p>
              <p className="mt-1 text-xs text-muted">
                {o.variant_id && `الصنف: ${label(o.variant_id)} · `}{o.starts_on || o.ends_on ? `${o.starts_on ?? '…'} → ${o.ends_on ?? '…'} · ` : ''}استُخدم {o.uses}{o.max_uses ? ` من ${o.max_uses}` : ''} مرة
              </p>
            </button>
          </Card>
        ))}
      </div>

      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? 'تعديل عرض' : 'عرض جديد'} wide
        footer={f && <>
          {f.id && <Button variant="danger" className="me-auto" onClick={() => confirm('حذف العرض؟ لا يُحذف لو اتستخدم في فواتير.') && del.mutate(f.id!)}>حذف</Button>}
          <Button onClick={() => setF(null)}>إلغاء</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => { setErr(null); save.mutate(f) }}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</Button>
        </>}>
        {f && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><ErrorText error={err} /></div>
            <Field label="اسم العرض *"><input className={inputCls} dir="auto" value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="النوع"><select className={inputCls} value={f.kind} onChange={(e) => set({ kind: e.target.value as OfferKind })}>{Object.entries(OFFER_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            {f.kind !== 'bxgy' && <Field label={f.kind === 'percent' ? 'النسبة %' : f.kind === 'fixed' ? 'مبلغ الخصم' : 'سعر الباقة'}><input className={inputCls} dir="ltr" inputMode="decimal" value={f.value} onChange={(e) => set({ value: e.target.value })} /></Field>}
            {f.kind === 'percent' && <Field label="حد أقصى للخصم (اختياري)"><input className={inputCls} dir="ltr" inputMode="decimal" value={f.cap} onChange={(e) => set({ cap: e.target.value })} /></Field>}
            {(f.kind === 'percent' || f.kind === 'bxgy') && (
              <Field label={f.kind === 'bxgy' ? 'الصنف *' : 'قصره على صنف (اختياري)'}><select className={inputCls} value={f.variant_id} onChange={(e) => set({ variant_id: e.target.value })}><option value="">—</option>{variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></Field>
            )}
            {f.kind === 'percent' && <Field label="قصره على قسم (اختياري)"><select className={inputCls} value={f.category_id} onChange={(e) => set({ category_id: e.target.value })}><option value="">—</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            {f.kind === 'bxgy' && <>
              <Field label="اشتري (كمية)"><input className={inputCls} dir="ltr" inputMode="numeric" value={f.buy_qty} onChange={(e) => set({ buy_qty: e.target.value })} /></Field>
              <Field label="وخذ مجانًا (كمية)"><input className={inputCls} dir="ltr" inputMode="numeric" value={f.get_qty} onChange={(e) => set({ get_qty: e.target.value })} /></Field>
            </>}
            {f.kind === 'bundle' && (
              <div className="space-y-2 sm:col-span-2">
                <p className="text-sm font-semibold">أصناف الباقة</p>
                {f.items.map((it, i) => (
                  <div key={i} className="flex gap-2">
                    <select aria-label="الصنف" className={inputCls} value={it.variant_id} onChange={(e) => set({ items: f.items.map((x, j) => (j === i ? { ...x, variant_id: e.target.value } : x)) })}><option value="">اختر…</option>{variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
                    <input aria-label="الكمية" className={`${inputCls} !w-20`} dir="ltr" inputMode="numeric" value={it.qty} onChange={(e) => set({ items: f.items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
                    {f.items.length > 1 && <Button small variant="danger" onClick={() => set({ items: f.items.filter((_, j) => j !== i) })}>×</Button>}
                  </div>
                ))}
                <Button small onClick={() => set({ items: [...f.items, { variant_id: '', qty: '1' }] })}>+ صنف</Button>
              </div>
            )}
            <Field label="يبدأ في"><input type="date" className={inputCls} value={f.starts_on} onChange={(e) => set({ starts_on: e.target.value })} /></Field>
            <Field label="ينتهي في"><input type="date" className={inputCls} value={f.ends_on} onChange={(e) => set({ ends_on: e.target.value })} /></Field>
            <Field label="أقصى عدد استخدامات (اختياري)"><input className={inputCls} dir="ltr" inputMode="numeric" value={f.max_uses} onChange={(e) => set({ max_uses: e.target.value })} /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> مفعّل</label>
          </div>
        )}
      </Modal>
    </div>
  )
}
