import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { formatCairo } from '../lib/time'
import { useAuth } from '../auth/AuthProvider'
import { formatEGP, toMinor } from '../lib/money'
import {
  cairoDateTimeInput, NEXT_REPAIR_STATUS, PART_REQUEST_STATUS, repairNumber, REPAIR_STATUS,
  type RepairBranch, type RepairDetail, type RepairEvent, type RepairOrderPart, type RepairPartRequest,
} from '../lib/repairs'
import { printRepairReceipt } from '../lib/receipts'
import CustomerContact from './CustomerContact'
import RepairMoney from './RepairMoney'
import RepairQuoteForm from './RepairQuoteForm'
import { State } from './State'
import { Button, Chip, ErrorText, Field, inputCls, Modal } from './ui'

export default function RepairOrderDialog({ id, branches, onClose }: {
  id: string; branches: RepairBranch[]; onClose: () => void
}) {
  const client = useQueryClient()
  const { hasRole, fullName } = useAuth()
  const [notice, setNotice] = useState('')
  const details = useQuery({
    queryKey: ['repair', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_orders')
        .select('id,order_number,branch_id,device_id,customer_name,customer_phone,device_model,serial,imei1,imei2,missing_identifier_reason,complaint,intake_condition,accessories,diagnosis,technician,custody_location,status,due_at,received_at,delivered_at,revision,labor_cost,parts_cost,quote_total,quoted_at,customer_informed_at,customer_decision,warranty_days,warranty_until,customer_id,brand,expected_price,credit_amount')
        .eq('id', id).single()
      if (error) throw error
      return data as RepairDetail
    },
  })
  const lines = useQuery({
    queryKey: ['repair-order-parts', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_order_parts')
        .select('id,part_id,qty,unit_price,consumed_at,repair_parts(name)').eq('order_id', id)
      if (error) throw error
      return data as unknown as RepairOrderPart[]
    },
  })
  const requests = useQuery({
    queryKey: ['repair-order-requests', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_part_requests')
        .select('id,order_id,branch_id,part_id,qty,status,requested_at,decision_note,repair_parts(name),repair_orders(order_number,device_model)')
        .eq('order_id', id).order('requested_at', { ascending: false })
      if (error) throw error
      return data as unknown as RepairPartRequest[]
    },
  })
  const startDiagnosis = useMutation({
    mutationFn: async (current: RepairDetail) => {
      const { error } = await supabase.rpc('update_repair', {
        p_id: current.id, p_revision: current.revision,
        p_update: {
          status: 'diagnosing', note: 'بدء فحص الجهاز', custody_location: current.custody_location,
          technician: current.technician || fullName || '', diagnosis: current.diagnosis ?? '',
        },
      })
      if (error) throw error
    },
    onSuccess: () => refresh(),
  })
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['repairs'] }), client.invalidateQueries({ queryKey: ['maintenance'] }),
      details.refetch(), events.refetch(), lines.refetch(), requests.refetch(),
    ])
  }
  const events = useQuery({
    queryKey: ['repair-events', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('repair_events')
        .select('id,status,due_at,custody_location,technician,diagnosis,note,actor_name,occurred_at').eq('order_id', id).order('id', { ascending: false })
      if (error) throw error
      return data as RepairEvent[]
    },
  })
  const order = details.data
  const branch = branches.find((item) => item.id === order?.branch_id)

  return (
    <Modal open wide onClose={onClose} title={order ? `أمر صيانة ${repairNumber(order.order_number)}` : 'أمر الصيانة'}>
      {details.isLoading && <State kind="loading" />}
      {details.isError && <State kind="error" text="تعذّر تحميل أمر الصيانة." action={<Button onClick={() => void details.refetch()}>حاول تاني</Button>} />}
      {order && <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold" dir="auto">{order.device_model}</h3>
          <Chip tone={order.status === 'ready' || order.status === 'delivered' ? 'ok' : 'info'}>{REPAIR_STATUS[order.status]}</Chip>
          {order.device_id && <Chip>مرتبط بجهاز مباع من الفرع</Chip>}
          <Button small className="ms-auto" onClick={() => printRepairReceipt({ number: repairNumber(order.order_number), received_at: order.received_at, due_at: order.due_at, customer_name: order.customer_name, customer_phone: order.customer_phone, device_model: order.device_model, serial: order.serial, imei1: order.imei1, complaint: order.complaint, intake_condition: order.intake_condition, accessories: order.accessories, quote_total: order.quote_total, warranty_days: order.warranty_days })}>طباعة إيصال</Button>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[
            ['العميل', order.customer_name], ['رقم الموبايل', order.customer_phone], ['الفرع', branch?.name],
            ['الماركة', order.brand], ['السعر المتوقع', order.expected_price != null ? formatEGP(toMinor(order.expected_price)) : null],
            ['السيريال', order.serial], ['IMEI 1', order.imei1], ['IMEI 2', order.imei2],
            ['سبب عدم توفر الرقم', order.missing_identifier_reason], ['الملحقات', order.accessories],
            ['شكوى العميل', order.complaint], ['حالة الاستلام', order.intake_condition],
            ['استلام الجهاز', formatCairo(order.received_at)], ['موعد التسليم', order.due_at ? formatCairo(order.due_at) : 'لسه غير محدد'],
            ['مكان الجهاز / العهدة', order.custody_location], ['الفني', order.technician], ['التشخيص', order.diagnosis],
            ['التسليم الفعلي', order.delivered_at && formatCairo(order.delivered_at)],
            ['الضمان', order.warranty_until ? `${order.warranty_days} يوم · حتى ${order.warranty_until}` : null],
          ].map(([label, value]) => value && <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="whitespace-pre-wrap break-words" dir="auto">{value}</dd>
          </div>)}
        </dl>
        {notice && <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{notice}</p>}
        {order.quoted_at && <section className="space-y-2 rounded-xl border border-line p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">التسعير</h3>
            {order.customer_decision === 'approved' && <Chip tone="ok">العميل وافق</Chip>}
            {order.customer_decision === 'declined' && <Chip tone="danger">العميل رفض</Chip>}
            {!order.customer_decision && (order.customer_informed_at
              ? <Chip tone="info">العميل اتبلّغ وبيفكر</Chip> : <Chip tone="warn">بانتظار إبلاغ العميل</Chip>)}
          </div>
          {lines.data?.map((line) => <p key={line.id} className="flex justify-between">
            <span dir="auto">{line.repair_parts?.name} × {line.qty} {line.consumed_at && <Chip tone="ok">اتصرفت من المخزن</Chip>}</span>
            <span>{formatEGP(line.qty * toMinor(line.unit_price))}</span></p>)}
          <p className="flex justify-between"><span>مصنعية</span><span>{formatEGP(toMinor(order.labor_cost))}</span></p>
          <p className="flex justify-between border-t border-line pt-1 font-bold"><span>الإجمالي</span><span>{formatEGP(toMinor(order.quote_total))}</span></p>
        </section>}
        {requests.data && requests.data.length > 0 && <section className="space-y-1 rounded-xl border border-line p-3 text-sm">
          <h3 className="font-semibold">طلبات القطع للمدير</h3>
          {requests.data.map((request) => <p key={request.id} className="flex flex-wrap items-center gap-2">
            <span dir="auto">{request.repair_parts?.name} × {request.qty}</span>
            <Chip tone={request.status === 'received' ? 'ok' : request.status === 'rejected' ? 'danger' : 'warn'}>{PART_REQUEST_STATUS[request.status]}</Chip>
            {request.decision_note && <span className="text-muted" dir="auto">{request.decision_note}</span>}
          </p>)}
        </section>}
        {branch?.can_update && order.status === 'received' && hasRole('technician', 'owner', 'manager') &&
          <div className="space-y-2"><ErrorText error={startDiagnosis.error} />
            <Button variant="primary" disabled={startDiagnosis.isPending} onClick={() => startDiagnosis.mutate(order)}>
              {startDiagnosis.isPending ? 'جارٍ الحفظ…' : 'استلمت الجهاز وبدأت الفحص'}</Button></div>}
        {branch?.can_update && (order.status === 'diagnosing' || order.status === 'awaiting_approval') && hasRole('technician', 'owner', 'manager') &&
          <RepairQuoteForm key={`quote-${id}-${order.revision}`} order={order} current={lines.data ?? []}
            onSaved={async (opened) => {
              setNotice(opened > 0 ? `اتفتح ${opened} طلب قطع للمدير لأن المخزن مش مغطي المطلوب.` : '')
              await refresh()
            }} />}
        {branch?.can_update && order.status === 'awaiting_approval' && !!order.quoted_at && hasRole('cashier', 'owner', 'manager') &&
          <CustomerContact key={`contact-${id}-${order.revision}`} order={order} lines={lines.data ?? []} onSaved={refresh} />}
        <RepairMoney key={`money-${id}-${order.revision}`} order={order} onChanged={refresh} />
        {branch?.can_update && order.status !== 'delivered' && <RepairUpdate key={`${id}-${order.revision}`} order={order}
          onSaved={refresh} />}
        <section className="border-t border-line pt-4">
          <h3 className="mb-3 font-semibold">سجل الحالة والعهدة</h3>
          {events.isLoading && <p role="status" className="text-sm text-muted">جارٍ تحميل السجل…</p>}
          {events.isError && <Button small onClick={() => void events.refetch()}>تعذّر تحميل السجل. حاول تاني</Button>}
          <ol className="space-y-3 border-s border-line ps-3 text-sm">
            {events.data?.map((entry) => <li key={entry.id}>
              <p className="font-medium">{REPAIR_STATUS[entry.status]} · {entry.custody_location}</p>
              <p className="text-muted">{formatCairo(entry.occurred_at)} · {entry.actor_name || 'موظف المحل'}</p>
              <p className="text-muted">موعد التسليم {entry.due_at ? formatCairo(entry.due_at) : 'لسه غير محدد'}</p>
              {entry.technician && <p className="text-muted">الفني {entry.technician}</p>}
              {entry.diagnosis && <p className="whitespace-pre-wrap break-words text-muted">التشخيص · {entry.diagnosis}</p>}
              {entry.note && <p className="whitespace-pre-wrap break-words" dir="auto">{entry.note}</p>}
            </li>)}
          </ol>
        </section>
      </div>}
    </Modal>
  )
}

function RepairUpdate({ order, onSaved }: { order: RepairDetail; onSaved: () => Promise<void> }) {
  const initialDue = cairoDateTimeInput(order.due_at)
  const update = useMutation({
    mutationFn: async (form: FormData) => {
      const values = Object.fromEntries(form.entries())
      if (values.due_at === initialDue) delete values.due_at
      const { error } = await supabase.rpc('update_repair', { p_id: order.id, p_revision: order.revision, p_update: values })
      if (error) throw error
    },
    onSuccess: onSaved,
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    update.mutate(new FormData(event.currentTarget))
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line bg-bg p-3 sm:grid-cols-2">
      <h3 className="font-semibold sm:col-span-2">تحديث أمر الصيانة</h3>
      <Field label="الحالة">
        <select className={inputCls} name="status" defaultValue={order.status}>
          {[order.status, ...NEXT_REPAIR_STATUS[order.status]].filter((status) => status !== 'delivered').map((status) => <option key={status} value={status}>{REPAIR_STATUS[status]}</option>)}
        </select>
      </Field>
      <Field label="موعد التسليم بتوقيت القاهرة"><input className={inputCls} name="due_at" type="datetime-local" dir="ltr" defaultValue={initialDue} /></Field>
      <Field label="مكان الجهاز أو الشخص اللي استلم العهدة"><input className={inputCls} name="custody_location" defaultValue={order.custody_location} maxLength={200} required /></Field>
      <Field label="الفني"><input className={inputCls} name="technician" defaultValue={order.technician ?? ''} maxLength={120} /></Field>
      <Field label="التشخيص"><textarea className={inputCls} name="diagnosis" rows={2} maxLength={1500} defaultValue={order.diagnosis ?? ''} /></Field>
      <Field label="سبب التحديث أو تفاصيل التسليم"><textarea className={inputCls} name="note" rows={2} maxLength={1000} required /></Field>
      <div className="sm:col-span-2"><ErrorText error={update.error} /></div>
      <div className="flex justify-end sm:col-span-2"><Button variant="primary" disabled={update.isPending}>{update.isPending ? 'جارٍ الحفظ…' : 'حفظ التحديث'}</Button></div>
    </form>
  )
}
