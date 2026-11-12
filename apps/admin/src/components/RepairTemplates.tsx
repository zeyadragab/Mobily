import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { useRepairTemplates, WARRANTY_CHOICES, type RepairTemplate } from '../lib/repairs'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal } from './ui'
import { State } from './State'

/** Reusable service lines (e.g. "screen replacement": labour + warranty). Owner and manager edit; others read. */
export default function RepairTemplates() {
  const { hasRole } = useAuth()
  const canEdit = hasRole('owner', 'manager')
  const qc = useQueryClient()
  const list = useRepairTemplates()
  const [edit, setEdit] = useState<Partial<RepairTemplate> | null>(null)
  const [name, setName] = useState('')
  const [labor, setLabor] = useState('')
  const [days, setDays] = useState(0)
  const [notes, setNotes] = useState('')

  function open(t: Partial<RepairTemplate> | null) {
    setEdit(t ?? {})
    setName(t?.name ?? ''); setLabor(t?.default_labor != null ? fromMinor(toMinor(t.default_labor)) : ''); setDays(t?.default_warranty_days ?? 0); setNotes(t?.notes ?? '')
  }
  const save = useMutation({
    mutationFn: async (active: boolean) => {
      let m = 0
      try { m = labor.trim() ? toMinor(labor) : 0 } catch { m = -1 }
      if (!name.trim() || m < 0) throw new Error('اكتب اسم القالب والمصنعية بشكل صحيح.')
      const { error } = await supabase.rpc('save_repair_template', {
        p_id: edit?.id ?? null, p_name: name, p_labor: Number(fromMinor(m)), p_warranty_days: days, p_notes: notes || null, p_active: active,
      })
      if (error) throw error
    },
    onSuccess: async () => { setEdit(null); await qc.invalidateQueries({ queryKey: ['repair-templates'] }) },
  })

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted">قوالب جاهزة للأعطال الشائعة. الفني يختارها وهو بيسعّر فتتملّى المصنعية.</p>
        {canEdit && <Button variant="primary" onClick={() => open(null)}>+ قالب جديد</Button>}
      </div>
      {list.isLoading && <State kind="loading" />}
      {list.isError && <State kind="error" text="تعذّر تحميل القوالب." />}
      {list.isSuccess && list.data.length === 0 && <State kind="empty" title="لسه مفيش قوالب" text={canEdit ? 'أضف أول قالب مثل «تغيير شاشة».' : undefined} />}
      {list.data && list.data.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-muted"><tr className="border-b border-line">{['القالب', 'المصنعية', 'الضمان', 'الحالة', ''].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>{list.data.map((t) => (
              <tr key={t.id} className="border-b border-line last:border-0">
                <td className="p-3"><p className="font-medium" dir="auto">{t.name}</p>{t.notes && <p className="text-xs text-muted" dir="auto">{t.notes}</p>}</td>
                <td className="p-3">{formatEGP(toMinor(t.default_labor))}</td>
                <td className="p-3">{t.default_warranty_days ? `${t.default_warranty_days} يوم` : 'بدون'}</td>
                <td className="p-3">{t.is_active ? <Chip tone="ok">مفعّل</Chip> : <Chip>موقوف</Chip>}</td>
                <td className="p-3 text-end">{canEdit && <Button small onClick={() => open(t)}>تعديل</Button>}</td>
              </tr>))}</tbody>
          </table>
        </Card>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'تعديل قالب' : 'قالب جديد'}
        footer={<>{edit?.id && edit.is_active && <Button variant="danger" className="me-auto" disabled={save.isPending} onClick={() => save.mutate(false)}>إيقاف</Button>}
          <Button onClick={() => setEdit(null)}>إلغاء</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(true)}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</Button></>}>
        <div className="space-y-3">
          <Field label="اسم القالب"><input className={inputCls} dir="auto" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="المصنعية الافتراضية (جنيه)"><input className={inputCls} dir="ltr" inputMode="decimal" value={labor} onChange={(e) => setLabor(e.target.value)} /></Field>
            <Field label="الضمان الافتراضي"><select className={inputCls} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {WARRANTY_CHOICES.map((d) => <option key={d} value={d}>{d === 0 ? 'بدون ضمان' : `${d} يوم`}</option>)}</select></Field>
          </div>
          <Field label="ملاحظات (اختياري)"><input className={inputCls} dir="auto" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <ErrorText error={save.error} />
        </div>
      </Modal>
    </div>
  )
}
