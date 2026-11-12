import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatCairo } from '../lib/time'
import { repairNumber, type WarrantyRow } from '../lib/repairs'
import { Button, Chip, ErrorText, Field, inputCls, Modal } from './ui'

/** Finds a delivered repair by IMEI, serial or RP number and says if the warranty is still valid. */
export default function WarrantyChecker({ onClose }: { onClose: () => void }) {
  const [term, setTerm] = useState('')
  const search = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('check_repair_warranty', { p_term: term })
      if (error) throw error
      return data as WarrantyRow[]
    },
  })
  return (
    <Modal open onClose={onClose} title="مدقق الضمان" footer={<Button onClick={onClose}>إغلاق</Button>}>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); search.mutate() }}>
        <Field label="IMEI أو السيريال أو رقم الأمر (RP-12)" className="flex-1">
          <input className={inputCls} dir="ltr" autoFocus value={term} onChange={(e) => setTerm(e.target.value)} maxLength={40} />
        </Field>
        <Button variant="primary" disabled={search.isPending || term.trim().length < 3}>{search.isPending ? 'جارٍ البحث…' : 'بحث'}</Button>
      </form>
      <div className="mt-3 space-y-3">
        <ErrorText error={search.error} />
        {search.data && search.data.length === 0 && <p role="status" className="text-sm text-muted">مفيش جهاز اتسلّم بالرقم ده.</p>}
        {search.data?.map((r) => (
          <div key={r.order_number} className="rounded-xl border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <bdi className="font-mono">{repairNumber(r.order_number)}</bdi>
              <span className="font-semibold" dir="auto">{r.device_model}</span>
              {r.warranty_until == null ? <Chip>بدون ضمان</Chip>
                : r.is_valid ? <Chip tone="ok">الضمان ساري · باقي {r.days_left} يوم</Chip> : <Chip tone="danger">الضمان انتهى</Chip>}
            </div>
            <p className="mt-1 text-muted" dir="auto">{r.customer_name} · تسليم {formatCairo(r.delivered_at)}</p>
            {r.warranty_until && <p className="text-muted">مدة الضمان {r.warranty_days} يوم · حتى {r.warranty_until}</p>}
          </div>
        ))}
      </div>
    </Modal>
  )
}
