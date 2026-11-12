import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { formatEGP, toMinor } from '../lib/money'
import { whatsappDigits, type RepairDetail, type RepairOrderPart } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { formatCairo } from '../lib/time'
import { Button, Chip, ErrorText, Field, inputCls } from './ui'

/** Cashier step: tell the customer the issue and the cost, then record what they answered. */
export default function CustomerContact({ order, lines, onSaved }: {
  order: RepairDetail; lines: RepairOrderPart[]; onSaved: () => Promise<void>
}) {
  const [note, setNote] = useState('')
  const decide = useMutation({
    mutationFn: async (decision: 'informed' | 'approved' | 'declined') => {
      const { error } = await supabase.rpc('record_customer_decision', {
        p_id: order.id, p_revision: order.revision, p_decision: decision, p_note: note,
      })
      if (error) throw error
    },
    onSuccess: onSaved,
  })
  const message = `أهلاً ${order.customer_name}، بخصوص جهازك ${order.device_model} (رقم الأمر RP-${order.order_number}): ${order.diagnosis ?? ''}`
    + ` — التكلفة ${formatEGP(toMinor(order.quote_total))}. تحب نكمل الإصلاح؟`

  return (
    <section className="space-y-3 rounded-xl border border-warn/40 bg-warn/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">إبلاغ العميل بالتشخيص والتكلفة</h3>
        {order.customer_informed_at
          ? <Chip tone="ok">اتبلّغ {formatCairo(order.customer_informed_at)}</Chip>
          : <Chip tone="warn">لسه ما اتبلّغش</Chip>}
      </div>
      <p className="whitespace-pre-wrap text-sm" dir="auto">{order.diagnosis}</p>
      <ul className="text-sm">
        {lines.map((line) => <li key={line.id} className="flex justify-between"><span dir="auto">{line.repair_parts?.name} × {line.qty}</span><span>{formatEGP(line.qty * toMinor(line.unit_price))}</span></li>)}
        <li className="flex justify-between"><span>مصنعية</span><span>{formatEGP(toMinor(order.labor_cost))}</span></li>
        <li className="flex justify-between border-t border-line pt-1 text-base font-bold"><span>الإجمالي</span><span>{formatEGP(toMinor(order.quote_total))}</span></li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <a className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium hover:bg-bg" href={`tel:${order.customer_phone}`}>اتصال <bdi>{order.customer_phone}</bdi></a>
        <a className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium hover:bg-bg" target="_blank" rel="noreferrer"
          href={`https://wa.me/${whatsappDigits(order.customer_phone)}?text=${encodeURIComponent(message)}`}>واتساب بالرسالة جاهزة</a>
      </div>
      <Field label="ملاحظة (ماذا قال العميل / وسيلة التواصل)">
        <textarea className={inputCls} rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <ErrorText error={decide.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" disabled={decide.isPending || !note.trim()} onClick={() => decide.mutate('informed')}>اتبلّغ وبيفكر</Button>
        <Button type="button" variant="danger" disabled={decide.isPending || !note.trim()} onClick={() => decide.mutate('declined')}>العميل رفض</Button>
        <Button type="button" variant="primary" disabled={decide.isPending || !note.trim()} onClick={() => decide.mutate('approved')}>العميل وافق</Button>
      </div>
    </section>
  )
}
