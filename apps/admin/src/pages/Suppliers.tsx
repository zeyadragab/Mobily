import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { CAN_BUY } from '../lib/roles'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { State } from '../components/State'

export type Supplier = {
  id: string
  name: string
  status: 'active' | 'inactive'
  phone: string | null
  whatsapp: string | null
  email: string | null
  address: string | null
  categories: string | null
  lead_time_days: number | null
  payment_terms: string | null
  notes: string | null
}

export function useSuppliers() {
  return useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('*').order('name')
      if (error) throw error
      return data as Supplier[]
    },
  })
}

type Form = {
  id?: string
  name: string
  status: 'active' | 'inactive'
  phone: string
  whatsapp: string
  email: string
  address: string
  categories: string
  lead_time_days: string
  payment_terms: string
  notes: string
}
const empty: Form = {
  name: '', status: 'active', phone: '', whatsapp: '', email: '', address: '',
  categories: '', lead_time_days: '', payment_terms: '', notes: '',
}
const digits = (s: string | null) => (s ?? '').replace(/\D/g, '')

export default function Suppliers() {
  const { hasRole } = useAuth()
  const canEdit = hasRole(...CAN_BUY)
  const qc = useQueryClient()
  const q = useSuppliers()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('active')
  const [editing, setEditing] = useState<Form | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter(
      (r) =>
        (status === 'all' || r.status === status) &&
        (!s || r.name.toLowerCase().includes(s) || digits(r.phone).includes(digits(s) || '§') || (r.categories ?? '').toLowerCase().includes(s)),
    )
  }, [q.data, search, status])

  const dupes = useMemo(() => {
    if (!editing || !q.data) return []
    const n = editing.name.trim().toLowerCase()
    const p = digits(editing.phone)
    return q.data.filter(
      (r) => r.id !== editing.id && ((n && r.name.trim().toLowerCase() === n) || (p.length >= 7 && digits(r.phone) === p)),
    )
  }, [editing, q.data])

  const save = useMutation({
    mutationFn: async (f: Form) => {
      if (!f.name.trim()) throw new Error('اسم المورد مطلوب.')
      if (!f.phone.trim() && !f.whatsapp.trim() && !f.email.trim()) throw new Error('أضف وسيلة تواصل واحدة على الأقل.')
      const row = {
        name: f.name.trim(),
        status: f.status,
        phone: f.phone.trim() || null,
        whatsapp: f.whatsapp.trim() || null,
        email: f.email.trim() || null,
        address: f.address.trim() || null,
        categories: f.categories.trim() || null,
        lead_time_days: f.lead_time_days ? Math.max(0, parseInt(f.lead_time_days, 10) || 0) : null,
        payment_terms: f.payment_terms.trim() || null,
        notes: f.notes.trim() || null,
      }
      const { error } = f.id
        ? await supabase.from('suppliers').update(row).eq('id', f.id)
        : await supabase.from('suppliers').insert(row)
      if (error) throw error
    },
    onSuccess: () => {
      setEditing(null)
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'تعذّر الحفظ'),
  })

  function open(s?: Supplier) {
    setErr(null)
    setEditing(
      s
        ? {
            id: s.id, name: s.name, status: s.status, phone: s.phone ?? '', whatsapp: s.whatsapp ?? '',
            email: s.email ?? '', address: s.address ?? '', categories: s.categories ?? '',
            lead_time_days: s.lead_time_days?.toString() ?? '', payment_terms: s.payment_terms ?? '', notes: s.notes ?? '',
          }
        : { ...empty },
    )
  }
  const set = (p: Partial<Form>) => setEditing((f) => (f ? { ...f, ...p } : f))

  return (
    <div>
      <PageHeader
        title="الموردون"
        subtitle="دليل الموردين وجهات الاتصال وشروط الدفع. يُختار المورد من هنا في طلبات الشراء."
        actions={canEdit && <Button variant="primary" onClick={() => open()}>+ إضافة مورد</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className={`${inputCls} min-w-0 flex-1 sm:max-w-sm`}
          placeholder="بحث بالاسم أو الهاتف أو نوع البضاعة"
          aria-label="بحث"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={`${inputCls} sm:w-40`} aria-label="الحالة" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="active">النشطون</option>
          <option value="inactive">الموقوفون</option>
          <option value="all">الكل</option>
        </select>
      </div>

      {q.isLoading && <State kind="loading" />}
      {q.isError && <State kind="error" text="تعذّر تحميل الموردين." />}
      {q.data && rows.length === 0 && (
        <State
          kind="empty"
          title={q.data.length === 0 ? 'لا يوجد موردون بعد' : 'لا توجد نتائج'}
          action={q.data.length === 0 && canEdit ? <Button variant="primary" onClick={() => open()}>+ إضافة مورد</Button> : undefined}
        />
      )}
      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr className="border-b border-line">
                {['المورد', 'الهاتف', 'البضاعة', 'مدة التوريد', 'شروط الدفع', 'الحالة'].map((h) => (
                  <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={`border-b border-line last:border-0 ${canEdit ? 'cursor-pointer hover:bg-bg' : ''}`} onClick={() => canEdit && open(s)}>
                  <td className="p-3 font-medium" dir="auto">{s.name}</td>
                  <td className="p-3" dir="ltr">{s.phone ?? s.whatsapp ?? '—'}</td>
                  <td className="p-3">{s.categories ?? '—'}</td>
                  <td className="p-3">{s.lead_time_days != null ? `${s.lead_time_days} يوم` : '—'}</td>
                  <td className="p-3">{s.payment_terms ?? '—'}</td>
                  <td className="p-3">{s.status === 'active' ? <Chip tone="ok">نشط</Chip> : <Chip>موقوف</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'تعديل مورد' : 'إضافة مورد'}
        footer={
          editing && (
            <>
              <Button onClick={() => setEditing(null)}>إلغاء</Button>
              <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(editing)}>
                {save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}
              </Button>
            </>
          )
        }
      >
        {editing && (
          <div className="space-y-4">
            {err && <ErrorText error={new Error(err)} />}
            {dupes.length > 0 && (
              <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
                تنبيه: يوجد مورد بنفس الاسم أو الهاتف: {dupes.map((d) => d.name).join('، ')}. تأكد أنه ليس مكررًا.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="اسم المورد *" className="sm:col-span-2"><input className={inputCls} dir="auto" value={editing.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="الهاتف"><input className={inputCls} dir="ltr" inputMode="tel" value={editing.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
              <Field label="واتساب"><input className={inputCls} dir="ltr" inputMode="tel" value={editing.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} /></Field>
              <Field label="البريد الإلكتروني" className="sm:col-span-2"><input className={inputCls} dir="ltr" type="email" value={editing.email} onChange={(e) => set({ email: e.target.value })} /></Field>
              <Field label="العنوان" className="sm:col-span-2"><input className={inputCls} dir="auto" value={editing.address} onChange={(e) => set({ address: e.target.value })} /></Field>
              <Field label="نوع البضاعة"><input className={inputCls} dir="auto" value={editing.categories} onChange={(e) => set({ categories: e.target.value })} /></Field>
              <Field label="مدة التوريد (أيام)"><input className={inputCls} dir="ltr" inputMode="numeric" value={editing.lead_time_days} onChange={(e) => set({ lead_time_days: e.target.value })} /></Field>
              <Field label="شروط الدفع" className="sm:col-span-2"><input className={inputCls} dir="auto" placeholder="مثال: 50% مقدم والباقي عند الاستلام" value={editing.payment_terms} onChange={(e) => set({ payment_terms: e.target.value })} /></Field>
              <Field label="ملاحظات" className="sm:col-span-2"><textarea className={inputCls} rows={2} dir="auto" value={editing.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
              <Field label="الحالة">
                <select className={inputCls} value={editing.status} onChange={(e) => set({ status: e.target.value as Form['status'] })}>
                  <option value="active">نشط</option>
                  <option value="inactive">موقوف عن الطلبات الجديدة</option>
                </select>
              </Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
