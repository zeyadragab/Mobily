import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useCategories } from '../lib/data'
import { FIELD_KIND, useCategoryFields, type FieldKind } from '../lib/catalog'
import { Button, Chip, ErrorText, Field, inputCls, Modal } from './ui'

/** Categories and the spec fields each one asks for on the product form (Volt calls these templates). */
export default function CategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const cats = useCategories()
  const fields = useCategoryFields()
  const [sel, setSel] = useState<string>('')
  const [name, setName] = useState('')
  const [rename, setRename] = useState('')
  const [f, setF] = useState({ label: '', kind: 'short' as FieldKind, required: false, internal: false, options: '' })
  const [err, setErr] = useState<unknown>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['categories'] })
    void qc.invalidateQueries({ queryKey: ['category-fields'] })
    void qc.invalidateQueries({ queryKey: ['products'] })
  }
  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: unknown }>) => {
      const { error } = await fn()
      if (error) throw error
    },
    onSuccess: () => { setErr(null); refresh() },
    onError: setErr,
  })

  const current = cats.data?.find((c) => c.id === sel)
  const list = (fields.data ?? []).filter((x) => x.category_id === sel)

  function addCategory() {
    const n = name.trim()
    if (!n) return setErr(new Error('اكتب اسم القسم.'))
    run.mutate(() => supabase.from('categories').insert({ name: n, sort_order: 100 }), { onSuccess: () => setName('') })
  }
  function addField() {
    const label = f.label.trim()
    if (!sel) return setErr(new Error('اختر قسمًا أولًا.'))
    if (!label) return setErr(new Error('اكتب اسم الحقل.'))
    const options = f.kind === 'list' ? f.options.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean) : null
    if (f.kind === 'list' && (!options || options.length === 0)) return setErr(new Error('اكتب اختيارات القائمة مفصولة بفاصلة.'))
    run.mutate(
      () => supabase.from('category_fields').insert({ category_id: sel, label, kind: f.kind, required: f.required, internal: f.internal, options, sort_order: list.length }),
      { onSuccess: () => setF({ label: '', kind: 'short', required: false, internal: false, options: '' }) },
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="الأقسام وحقول المواصفات" wide footer={<Button onClick={onClose}>إغلاق</Button>}>
      <div className="grid gap-5 md:grid-cols-[14rem_1fr]">
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className={inputCls} placeholder="قسم جديد" aria-label="قسم جديد" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCategory()} />
            <Button small variant="primary" onClick={addCategory}>إضافة</Button>
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label="الأقسام">
            {cats.data?.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => { setSel(c.id); setRename(c.name); setErr(null) }}
                  className={`flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-start text-sm transition ${sel === c.id ? 'btn-gel' : 'hover:bg-bg'}`}>
                  <span dir="auto">{c.name}</span>
                  <span className="text-xs opacity-70">{(fields.data ?? []).filter((x) => x.category_id === c.id).length || ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <ErrorText error={err} />
          {!current && <p className="text-sm text-muted">اختر قسمًا لتعديل اسمه أو إضافة حقول مواصفات له (مثل الرام والمعالج ومقاومة الماء).</p>}
          {current && (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="اسم القسم" className="min-w-0 flex-1">
                  <input className={inputCls} value={rename} onChange={(e) => setRename(e.target.value)} dir="auto" />
                </Field>
                <Button small onClick={() => rename.trim() && run.mutate(() => supabase.from('categories').update({ name: rename.trim() }).eq('id', sel))}>حفظ الاسم</Button>
                <Button small variant="danger" onClick={() => confirm('حذف القسم؟ لا يُحذف لو عليه منتجات.') && run.mutate(async () => {
                  const r = await supabase.rpc('delete_category', { p_id: sel })
                  if (!r.error) setSel('')
                  return r
                })}>حذف</Button>
              </div>

              <div>
                <h3 className="mb-2 font-semibold">حقول المواصفات</h3>
                {list.length === 0 && <p className="text-sm text-muted">لا توجد حقول لهذا القسم بعد.</p>}
                <ul className="space-y-1.5">
                  {list.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                      <span dir="auto"><b>{x.label}</b> <span className="text-muted">· {FIELD_KIND[x.kind]}{x.options ? ` (${x.options.join('، ')})` : ''}</span></span>
                      <span className="flex items-center gap-2">
                        {x.required && <Chip tone="warn">مطلوب</Chip>}
                        {x.internal && <Chip tone="info">داخلي</Chip>}
                        <Button small onClick={() => run.mutate(() => supabase.from('category_fields').update({ required: !x.required }).eq('id', x.id))}>{x.required ? 'اجعله اختياريًا' : 'اجعله مطلوبًا'}</Button>
                        <Button small variant="danger" onClick={() => run.mutate(() => supabase.from('category_fields').delete().eq('id', x.id))}>حذف</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid gap-2 rounded-xl bg-bg p-3 sm:grid-cols-2">
                <Field label="اسم الحقل"><input className={inputCls} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} dir="auto" /></Field>
                <Field label="النوع">
                  <select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as FieldKind })}>
                    {Object.entries(FIELD_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
                {f.kind === 'list' && (
                  <Field label="الاختيارات (مفصولة بفاصلة)" className="sm:col-span-2"><input className={inputCls} value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} dir="auto" /></Field>
                )}
                <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} /> مطلوب</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.internal} onChange={(e) => setF({ ...f, internal: e.target.checked })} /> داخلي (لا يظهر على الموقع)</label>
                  <Button small variant="primary" className="ms-auto" onClick={addField}>+ إضافة الحقل</Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
