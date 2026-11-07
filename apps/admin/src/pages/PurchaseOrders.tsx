import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { CAN_BUY } from '../lib/roles'
import { useBranches, useCosts, useProducts, variantLabel } from '../lib/data'
import { formatEGP, fromMinor, toMinor } from '../lib/money'
import { cairoBusinessDate, formatCairo } from '../lib/time'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { State } from '../components/State'
import { useSuppliers } from './Suppliers'

type Status =
  | 'draft' | 'pending_approval' | 'approved' | 'rejected'
  | 'sent' | 'partially_received' | 'received' | 'cancelled'

const STATUS: Record<Status, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' }> = {
  draft: { label: 'مسودة', tone: 'neutral' },
  pending_approval: { label: 'بانتظار موافقة المالك', tone: 'warn' },
  approved: { label: 'تمت الموافقة', tone: 'info' },
  rejected: { label: 'مرفوضة', tone: 'danger' },
  sent: { label: 'أُرسلت للمورد', tone: 'info' },
  partially_received: { label: 'استلام جزئي', tone: 'warn' },
  received: { label: 'تم الاستلام', tone: 'ok' },
  cancelled: { label: 'ملغاة', tone: 'neutral' },
}

type Line = { id: string; po_id: string; variant_id: string; qty_ordered: number; qty_received: number; unit_cost: string }
type PO = {
  id: string
  po_number: string
  supplier_id: string
  status: Status
  notes: string | null
  expected_date: string | null
  total: string
  approval_id: string | null
  created_by: string
  created_at: string
  cancelled_reason: string | null
  supplier_snapshot: { name?: string; phone?: string; whatsapp?: string; payment_terms?: string } | null
  suppliers: { name: string } | null
  purchase_order_lines: Line[]
}
type Draft = {
  id?: string
  supplier_id: string
  expected_date: string
  notes: string
  lines: { variant_id: string; qty: string; unit_cost: string }[]
}

function usePOs() {
  return useQuery({
    queryKey: ['pos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, suppliers(name), purchase_order_lines(*)')
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) throw error
      return data as unknown as PO[]
    },
  })
}

export default function PurchaseOrders() {
  const { hasRole, session } = useAuth()
  const canBuy = hasRole(...CAN_BUY)
  const pos = usePOs()
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | 'new' | null>(null)

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (pos.data ?? []).filter(
      (p) =>
        (filter === 'all' || p.status === filter) &&
        (!s || p.po_number.toLowerCase().includes(s) || (p.suppliers?.name ?? '').toLowerCase().includes(s)),
    )
  }, [pos.data, filter, search])

  const po = pos.data?.find((p) => p.id === openId)

  return (
    <div>
      <PageHeader
        title="طلبات الشراء"
        subtitle="المدير يجهّز الطلبية، المالك يوافق، ثم تُرسل وتُستلم وتُحدَّث الكميات."
        actions={canBuy && <Button variant="primary" onClick={() => setOpenId('new')}>+ طلبية جديدة</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`} placeholder="بحث برقم الطلبية أو المورد" aria-label="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={`${inputCls} sm:w-56`} aria-label="الحالة" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">كل الحالات</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {pos.isLoading && <State kind="loading" />}
      {pos.isError && <State kind="error" text="تعذّر تحميل الطلبيات." />}
      {pos.data && rows.length === 0 && (
        <State kind="empty" title={pos.data.length === 0 ? 'لا توجد طلبيات بعد' : 'لا توجد نتائج'}
          action={pos.data.length === 0 && canBuy ? <Button variant="primary" onClick={() => setOpenId('new')}>+ طلبية جديدة</Button> : undefined} />
      )}
      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted"><tr className="border-b border-line">
              {['الرقم', 'المورد', 'الأصناف', 'الإجمالي', 'الحالة', 'التاريخ'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-bg" onClick={() => setOpenId(p.id)}>
                  <td className="p-3 font-mono text-xs" dir="ltr">{p.po_number}</td>
                  <td className="p-3 font-medium" dir="auto">{p.suppliers?.name ?? '—'}</td>
                  <td className="p-3">{p.purchase_order_lines.length}</td>
                  <td className="whitespace-nowrap p-3">{formatEGP(toMinor(p.total))}</td>
                  <td className="p-3"><Chip tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Chip></td>
                  <td className="whitespace-nowrap p-3">{formatCairo(p.created_at, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {openId && (
        <OrderDialog
          key={openId}
          po={openId === 'new' ? undefined : po}
          userId={session?.user.id ?? ''}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

function OrderDialog({ po, userId, onClose }: { po?: PO; userId: string; onClose: () => void }) {
  const { hasRole } = useAuth()
  const qc = useQueryClient()
  const canBuy = hasRole(...CAN_BUY)
  const canReceive = hasRole('owner', 'manager', 'warehouse')
  const isOwner = hasRole('owner')

  const suppliers = useSuppliers()
  const branches = useBranches()
  const products = useProducts()
  const costs = useCosts(true)

  const editable = canBuy && (!po || po.status === 'draft' || po.status === 'rejected')
  const [d, setD] = useState<Draft>(() =>
    po
      ? {
          id: po.id, supplier_id: po.supplier_id, expected_date: po.expected_date ?? '', notes: po.notes ?? '',
          lines: po.purchase_order_lines.map((l) => ({ variant_id: l.variant_id, qty: String(l.qty_ordered), unit_cost: l.unit_cost })),
        }
      : { supplier_id: '', expected_date: '', notes: '', lines: [] },
  )
  const [recv, setRecv] = useState<Record<string, string>>({})
  const [recvSerials, setRecvSerials] = useState<Record<string, string>>({})
  const trackedVariants = useMemo(
    () => new Set((products.data ?? []).filter((p) => p.track_serial).flatMap((p) => p.variants.map((v) => v.id))),
    [products.data],
  )
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<unknown>(null)

  const variants = useMemo(() => {
    const out: { id: string; label: string; active: boolean }[] = []
    for (const p of products.data ?? []) for (const v of p.variants) out.push({ id: v.id, label: variantLabel(p, v), active: v.is_active && p.is_active })
    return out
  }, [products.data])
  const label = (id: string) => variants.find((v) => v.id === id)?.label ?? id.slice(0, 8)

  const total = d.lines.reduce((s, l) => {
    try { return s + (parseInt(l.qty, 10) || 0) * toMinor(l.unit_cost || '0') } catch { return s }
  }, 0)

  const timeline = useQuery({
    queryKey: ['po-timeline', po?.id, po?.status],
    enabled: !!po,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_log')
        .select('id,occurred_at,actor_id,action,before,after')
        .eq('entity', 'purchase_orders').eq('entity_id', po!.id)
        .order('occurred_at')
      if (error) throw error
      const rows = data as { id: number; occurred_at: string; actor_id: string | null; action: string; before: { status?: Status } | null; after: { status?: Status } | null }[]
      const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[]
      const names = new Map<string, string>()
      if (ids.length) {
        const { data: ps } = await supabase.from('profiles').select('id,full_name').in('id', ids)
        for (const p of (ps ?? []) as { id: string; full_name: string }[]) names.set(p.id, p.full_name)
      }
      return rows
        .filter((r) => r.action === 'insert' || r.before?.status !== r.after?.status)
        .map((r) => ({
          id: r.id, at: r.occurred_at,
          who: (r.actor_id && names.get(r.actor_id)) || (r.actor_id ? r.actor_id.slice(0, 6) : 'النظام'),
          status: (r.after?.status ?? 'draft') as Status,
        }))
    },
  })

  const approval = useQuery({
    queryKey: ['po-approval', po?.approval_id, po?.status],
    enabled: !!po?.approval_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('approval_requests')
        .select('id,status,requested_by,decision_comment').eq('id', po!.approval_id!).single()
      if (error) throw error
      return data as { id: string; status: string; requested_by: string; decision_comment: string | null }
    },
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['pos'] })
    qc.invalidateQueries({ queryKey: ['approvals'] })
    qc.invalidateQueries({ queryKey: ['stock'] })
    qc.invalidateQueries({ queryKey: ['costs'] })
    qc.invalidateQueries({ queryKey: ['po-timeline'] })
    qc.invalidateQueries({ queryKey: ['po-approval'] })
  }

  async function persist(): Promise<string> {
    if (!d.supplier_id) throw new Error('اختر المورد.')
    const seen = new Set<string>()
    const lines = d.lines.map((l) => {
      if (!l.variant_id) throw new Error('اختر الصنف في كل سطر.')
      if (seen.has(l.variant_id)) throw new Error('الصنف مكرر في الطلبية.')
      seen.add(l.variant_id)
      const qty = parseInt(l.qty, 10)
      if (!qty || qty <= 0) throw new Error('الكمية يجب أن تكون أكبر من صفر.')
      let cost: string
      try { cost = fromMinor(toMinor(l.unit_cost || '0')) } catch { throw new Error('التكلفة رقم بحد أقصى خانتين عشريتين.') }
      return { variant_id: l.variant_id, qty_ordered: qty, unit_cost: cost }
    })
    const head = { supplier_id: d.supplier_id, expected_date: d.expected_date || null, notes: d.notes.trim() || null }
    let id = d.id
    if (id) {
      const { error } = await supabase.from('purchase_orders').update(head).eq('id', id)
      if (error) throw error
    } else {
      const branch = branches.data?.[0]
      if (!branch) throw new Error('لا يوجد فرع.')
      const { data, error } = await supabase.from('purchase_orders').insert({ ...head, branch_id: branch.id }).select('id').single()
      if (error) throw error
      id = data.id as string
    }
    const keep = lines.map((l) => l.variant_id)
    const del = supabase.from('purchase_order_lines').delete().eq('po_id', id)
    const { error: de } = keep.length ? await del.not('variant_id', 'in', `(${keep.join(',')})`) : await del
    if (de) throw de
    if (lines.length) {
      const { error } = await supabase.from('purchase_order_lines')
        .upsert(lines.map((l) => ({ ...l, po_id: id })), { onConflict: 'po_id,variant_id' })
      if (error) throw error
    }
    return id!
  }

  const run = useMutation({
    mutationFn: async (kind: 'save' | 'submit' | 'send' | 'receive' | 'cancel' | 'delete' | 'approve' | 'reject' | 'changes') => {
      setErr(null)
      if (kind === 'save') { await persist(); return 'close' }
      if (kind === 'submit') {
        const id = await persist()
        const { error } = await supabase.rpc('submit_purchase_order', { p_po: id })
        if (error) throw error
        return 'close'
      }
      if (!po) return
      if (kind === 'send') {
        const { error } = await supabase.rpc('send_purchase_order', { p_po: po.id })
        if (error) throw error
      }
      if (kind === 'cancel') {
        const { error } = await supabase.rpc('cancel_purchase_order', { p_po: po.id, p_reason: reason })
        if (error) throw error
        return 'close'
      }
      if (kind === 'delete') {
        const { error } = await supabase.from('purchase_orders').delete().eq('id', po.id)
        if (error) throw error
        return 'close'
      }
      if (kind === 'receive') {
        const lines = Object.entries(recv).map(([line_id, q]) => {
          const ln = po.purchase_order_lines.find((x) => x.id === line_id)
          const qty = parseInt(q, 10) || 0
          if (!ln || !trackedVariants.has(ln.variant_id)) return { line_id, qty }
          const serials = (recvSerials[line_id] ?? '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
          return { line_id, qty, serials }
        }).filter((l) => l.qty > 0)
        if (!lines.length) throw new Error('أدخل كمية مستلمة لصنف واحد على الأقل.')
        const { error } = await supabase.rpc('receive_purchase_order', { p_po: po.id, p_lines: lines })
        if (error) throw error
        setRecv({})
        setRecvSerials({})
        ;['devices', 'inventory'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      }
      if (kind === 'approve' || kind === 'reject' || kind === 'changes') {
        const { error } = await supabase.rpc('decide_approval', {
          p_request: po.approval_id,
          p_decision: kind === 'approve' ? 'approved' : kind === 'reject' ? 'rejected' : 'changes_requested',
          p_comment: comment || null,
        })
        if (error) throw error
        setComment('')
      }
    },
    onSuccess: (r) => { refresh(); if (r === 'close') onClose() },
    onError: (e) => setErr(e),
  })

  const setLine = (i: number, p: Partial<Draft['lines'][number]>) =>
    setD((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) }))
  const activeSuppliers = (suppliers.data ?? []).filter((s) => s.status === 'active' || s.id === d.supplier_id)
  const busy = run.isPending
  const canDecide = isOwner && po?.status === 'pending_approval' && approval.data?.requested_by !== userId
  const open = po && (po.status === 'sent' || po.status === 'partially_received')

  return (
    <Modal open wide onClose={onClose}
      title={po ? `طلبية ${po.po_number}` : 'طلبية شراء جديدة'}
      footer={
        <>
          {po?.status === 'draft' && canBuy && (
            <Button variant="danger" className="me-auto" disabled={busy} onClick={() => confirm('حذف المسودة؟') && run.mutate('delete')}>حذف المسودة</Button>
          )}
          <Button onClick={onClose}>إغلاق</Button>
          {editable && <Button disabled={busy} onClick={() => run.mutate('save')}>حفظ كمسودة</Button>}
          {editable && <Button variant="primary" disabled={busy} onClick={() => run.mutate('submit')}>{isOwner ? 'اعتماد' : 'إرسال للمالك للموافقة'}</Button>}
          {po?.status === 'approved' && canBuy && <Button variant="primary" disabled={busy} onClick={() => run.mutate('send')}>تأكيد الإرسال للمورد</Button>}
          {open && canReceive && <Button variant="primary" disabled={busy} onClick={() => run.mutate('receive')}>تسجيل الاستلام</Button>}
        </>
      }
    >
      <div className="space-y-5">
        <ErrorText error={err} />

        {po && (
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={STATUS[po.status].tone}>{STATUS[po.status].label}</Chip>
            <span className="text-sm text-muted">الإجمالي: {formatEGP(toMinor(po.total))}</span>
          </div>
        )}

        {po?.status === 'rejected' && approval.data?.decision_comment && (
          <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">ملاحظة المالك: {approval.data.decision_comment}</p>
        )}
        {po?.status === 'draft' && approval.data?.status === 'changes_requested' && (
          <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">المالك طلب تعديلًا{approval.data.decision_comment ? `: ${approval.data.decision_comment}` : ''}. عدّل ثم أعد الإرسال.</p>
        )}
        {po?.status === 'cancelled' && <p className="text-sm text-muted">سبب الإلغاء: {po.cancelled_reason}</p>}

        {/* header */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="المورد *">
            <select className={inputCls} disabled={!editable} value={d.supplier_id} onChange={(e) => setD({ ...d, supplier_id: e.target.value })}>
              <option value="">— اختر من الدليل —</option>
              {activeSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="تاريخ التوريد المتوقع">
            <input type="date" min={cairoBusinessDate()} className={inputCls} dir="ltr" disabled={!editable} value={d.expected_date} onChange={(e) => setD({ ...d, expected_date: e.target.value })} />
          </Field>
          <Field label="ملاحظات">
            <input className={inputCls} dir="auto" disabled={!editable} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
          </Field>
        </div>
        {(() => {
          const s = po?.supplier_snapshot ?? (suppliers.data ?? []).find((x) => x.id === d.supplier_id)
          if (!s) return null
          const sn = s as { phone?: string | null; whatsapp?: string | null; payment_terms?: string | null }
          return (
            <p className="text-xs text-muted">
              {po?.supplier_snapshot ? 'بيانات المورد وقت الاعتماد: ' : 'بيانات المورد الحالية: '}
              {[sn.phone, sn.whatsapp && `واتساب ${sn.whatsapp}`, sn.payment_terms].filter(Boolean).join(' · ') || 'لا توجد بيانات'}
            </p>
          )
        })()}

        {/* lines */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">الأصناف</h3>
            {editable && <Button small onClick={() => setD({ ...d, lines: [...d.lines, { variant_id: '', qty: '1', unit_cost: '' }] })}>+ صنف</Button>}
          </div>
          {d.lines.length === 0 && <p className="text-sm text-muted">لم تُضف أصناف بعد.</p>}
          <div className="space-y-2">
            {d.lines.map((l, i) => {
              const saved = po?.purchase_order_lines.find((x) => x.variant_id === l.variant_id)
              const left = saved ? saved.qty_ordered - saved.qty_received : 0
              return (
                <div key={i} className="grid items-end gap-2 rounded-xl border border-line p-3 sm:grid-cols-12">
                  <Field label="الصنف" className="sm:col-span-5">
                    {editable ? (
                      <select className={inputCls} value={l.variant_id}
                        onChange={(e) => setLine(i, { variant_id: e.target.value, unit_cost: l.unit_cost || costs.data?.get(e.target.value) || '' })}>
                        <option value="">— اختر —</option>
                        {variants.filter((v) => v.active || v.id === l.variant_id).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </select>
                    ) : <p className="py-2 text-sm" dir="auto">{label(l.variant_id)}</p>}
                  </Field>
                  <Field label="الكمية" className="sm:col-span-2"><input className={inputCls} dir="ltr" inputMode="numeric" disabled={!editable} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></Field>
                  <Field label="تكلفة الوحدة" className="sm:col-span-2"><input className={inputCls} dir="ltr" inputMode="decimal" disabled={!editable} value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} /></Field>
                  {po && !editable ? (
                    <div className="sm:col-span-3">
                      <p className="text-xs text-muted">المستلم {saved?.qty_received ?? 0} من {saved?.qty_ordered ?? 0}</p>
                      {open && canReceive && left > 0 && saved && (
                        <>
                          <input className={`${inputCls} mt-1`} dir="ltr" inputMode="numeric" placeholder={`استلام (حتى ${left})`} aria-label="كمية الاستلام"
                            value={recv[saved.id] ?? ''} onChange={(e) => setRecv({ ...recv, [saved.id]: e.target.value })} />
                          {trackedVariants.has(saved.variant_id) && (
                            <textarea className={`${inputCls} mt-1 font-mono`} dir="ltr" rows={3} aria-label="سيريال / IMEI لكل جهاز مستلم"
                              placeholder="سيريال / IMEI — سطر لكل جهاز مستلم" value={recvSerials[saved.id] ?? ''}
                              onChange={(e) => setRecvSerials({ ...recvSerials, [saved.id]: e.target.value })} />
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="sm:col-span-3 sm:text-end">
                      {editable && <Button small variant="danger" onClick={() => setD({ ...d, lines: d.lines.filter((_, j) => j !== i) })}>إزالة</Button>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {editable && <p className="mt-2 text-sm font-semibold">الإجمالي: {formatEGP(total)}</p>}
        </div>

        {/* owner decision */}
        {canDecide && (
          <div className="space-y-2 rounded-xl border border-warn/40 bg-warn/5 p-4">
            <p className="font-semibold">قرارك على هذه الطلبية</p>
            <input className={inputCls} placeholder="تعليق (اختياري)" aria-label="تعليق" dir="auto" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy} onClick={() => run.mutate('approve')}>موافقة</Button>
              <Button disabled={busy} onClick={() => run.mutate('changes')}>طلب تعديل</Button>
              <Button variant="danger" disabled={busy} onClick={() => run.mutate('reject')}>رفض</Button>
            </div>
          </div>
        )}
        {po?.status === 'pending_approval' && !canDecide && (
          <p className="text-sm text-muted">الطلبية بانتظار قرار المالك. لن يمكن إرسالها للمورد قبل الموافقة.</p>
        )}

        {/* cancel */}
        {po && canBuy && !['received', 'cancelled', 'partially_received'].includes(po.status) && (
          <details className="rounded-xl border border-line p-3 text-sm">
            <summary className="cursor-pointer text-muted">إلغاء الطلبية</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <input className={`${inputCls} flex-1`} placeholder="سبب الإلغاء *" dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => run.mutate('cancel')}>تأكيد الإلغاء</Button>
            </div>
          </details>
        )}

        {/* timeline */}
        {po && (
          <div>
            <h3 className="mb-2 font-semibold">تتبّع الطلبية</h3>
            {timeline.isLoading && <p className="text-sm text-muted">جارٍ التحميل…</p>}
            <ol className="space-y-2 border-s border-line ps-4">
              {timeline.data?.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -start-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-accent" />
                  <span className="font-medium">{STATUS[e.status]?.label ?? e.status}</span>
                  <span className="text-muted"> · {e.who} · {formatCairo(e.at)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Modal>
  )
}
