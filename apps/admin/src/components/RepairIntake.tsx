import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { RepairBranch } from '../lib/repairs'
import { Button, ErrorText, Field, inputCls, Modal } from './ui'

const TEXT_FIELDS = [
  { name: 'customer_name', label: 'اسم العميل', max: 120, required: true },
  { name: 'customer_phone', label: 'رقم موبايل العميل', max: 16, required: true, type: 'tel', pattern: '[+]?[0-9]{7,15}', ltr: true },
  { name: 'device_model', label: 'الماركة والموديل واللون', max: 120, required: true },
  { name: 'serial', label: 'السيريال', min: 5, max: 40, ltr: true },
  { name: 'imei1', label: 'IMEI 1', max: 15, pattern: '[0-9]{15}', ltr: true },
  { name: 'imei2', label: 'IMEI 2', max: 15, pattern: '[0-9]{15}', ltr: true },
  { name: 'missing_identifier_reason', label: 'سبب عدم توفر السيريال أو IMEI', max: 250 },
  { name: 'technician', label: 'اسم الفني', max: 120 },
  { name: 'custody_location', label: 'مكان الجهاز عند الاستلام', max: 200, required: true },
] as const

export default function RepairIntake({ branches, branchId, onClose, onReceived }: {
  branches: RepairBranch[]; branchId: string; onClose: () => void; onReceived: (id: string) => void
}) {
  const [id] = useState(() => crypto.randomUUID())
  const receive = useMutation({
    mutationFn: async (form: FormData) => {
      const { branch, ...intake } = Object.fromEntries(form.entries())
      if (!['serial', 'imei1', 'imei2', 'missing_identifier_reason'].some((key) => String(intake[key] ?? '').trim())) {
        throw new Error('اكتب السيريال أو IMEI، أو سجّل سبب عدم توفرهم.')
      }
      if (intake.imei1 && intake.imei1 === intake.imei2) throw new Error('رقما IMEI لازم يكونوا مختلفين.')
      const { data, error } = await supabase.rpc('receive_repair', { p_id: id, p_branch: branch, p_intake: intake })
      if (error) throw error
      return data as string
    },
    onSuccess: onReceived,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    receive.mutate(new FormData(event.currentTarget))
  }

  return (
    <Modal open wide onClose={onClose} title="استلام جهاز للصيانة">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <Field label="الفرع">
          <select className={inputCls} name="branch" defaultValue={branchId || branches[0]?.id} required>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </Field>
        {TEXT_FIELDS.map((field) => (
          <Field key={field.name} label={field.label}>
            <input className={inputCls} name={field.name} type={'type' in field ? field.type : 'text'}
              maxLength={field.max} minLength={'min' in field ? field.min : undefined} required={'required' in field}
              pattern={'pattern' in field ? field.pattern : undefined} dir={'ltr' in field ? 'ltr' : 'auto'} />
          </Field>
        ))}
        <Field label="موعد التسليم المتوقع" hint="بتوقيت القاهرة. سيبه فاضي لو الموعد لسه غير محدد.">
          <input className={inputCls} name="due_at" type="datetime-local" dir="ltr" />
        </Field>
        <Field label="شكوى العميل">
          <textarea className={inputCls} name="complaint" rows={3} maxLength={1500} required />
        </Field>
        <Field label="حالة الجهاز عند الاستلام" hint="حالة التشغيل، الكسر، الخدوش أو آثار السوائل.">
          <textarea className={inputCls} name="intake_condition" rows={3} maxLength={1500} required />
        </Field>
        <Field label="الملحقات المستلمة" className="sm:col-span-2">
          <input className={inputCls} name="accessories" maxLength={500} placeholder="مثال: جراب وشاحن" />
        </Field>
        <div className="sm:col-span-2"><ErrorText error={receive.error} /></div>
        <div className="flex justify-end sm:col-span-2">
          <Button variant="primary" disabled={receive.isPending}>{receive.isPending ? 'جارٍ تسجيل الجهاز…' : 'تسجيل الاستلام'}</Button>
        </div>
      </form>
    </Modal>
  )
}
