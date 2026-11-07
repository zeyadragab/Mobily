import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { formatEGP, toMinor } from '../lib/money'
import { useProducts } from '../lib/data'
import { formatCairo } from '../lib/time'
import { Button, Card, Chip, ErrorText, inputCls, Modal, PageHeader } from '../components/ui'
import { State } from '../components/State'

type Status = 'reserved' | 'confirmed' | 'ready' | 'delivered' | 'cancelled' | 'expired'
const STATUS: Record<Status, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' }> = {
  reserved: { label: 'محجوز بانتظار التأكيد', tone: 'warn' },
  confirmed: { label: 'مؤكد', tone: 'info' },
  ready: { label: 'جاهز', tone: 'info' },
  delivered: { label: 'تم التسليم', tone: 'ok' },
  cancelled: { label: 'ملغي', tone: 'danger' },
  expired: { label: 'انتهى الحجز', tone: 'neutral' },
}
const NEXT: Partial<Record<Status, { to: string; label: string }>> = {
  reserved: { to: 'confirmed', label: 'تأكيد الطلب' },
  confirmed: { to: 'ready', label: 'جاهز للتسليم' },
  ready: { to: 'delivered', label: 'تم التسليم' },
}

type Order = {
  id: string
  order_number: string
  customer_name: string
  phone: string
  address: string | null
  fulfilment: 'pickup' | 'delivery'
  notes: string | null
  status: Status
  total: string
  reserved_until: string
  cancel_reason: string | null
  created_at: string
  online_order_lines: { id: string; variant_id: string; name_snapshot: string; qty: number; unit_price: string }[]
}

export default function OnlineOrders() {
  const { hasRole } = useAuth()
  const canAct = hasRole('owner', 'manager', 'cashier')
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'open' | 'all' | Status>('open')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const q = useQuery({
    queryKey: ['online-orders'],
    refetchInterval: 30_000,
    queryFn: async () => {
      await supabase.rpc('expire_online_orders')
      const { data, error } = await supabase
        .from('online_orders')
        .select('*, online_order_lines(*)')
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) throw error
      return data as unknown as Order[]
    },
  })

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter(
      (o) =>
        (filter === 'all' ||
          (filter === 'open' ? ['reserved', 'confirmed', 'ready'].includes(o.status) : o.status === filter)) &&
        (!s || o.order_number.toLowerCase().includes(s) || o.customer_name.toLowerCase().includes(s) || o.phone.includes(s)),
    )
  }, [q.data, filter, search])

  const order = q.data?.find((o) => o.id === openId)

  // tracked items (IMEI / serial) need the exact devices when the order is delivered
  const products = useProducts()
  const trackedVariants = useMemo(
    () => new Set((products.data ?? []).filter((p) => p.track_serial).flatMap((p) => p.variants.map((v) => v.id))),
    [products.data],
  )
  const [serialsText, setSerialsText] = useState<Record<string, string>>({})
  const parse = (variantId: string) => (serialsText[variantId] ?? '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
  const trackedLines = order?.online_order_lines.filter((l) => trackedVariants.has(l.variant_id)) ?? []
  const serialsOk = trackedLines.every((l) => parse(l.variant_id).length === l.qty)
  const serialsPayload = Object.fromEntries(trackedLines.map((l) => [l.variant_id, parse(l.variant_id)]))

  const move = useMutation({
    mutationFn: async (v: { id: string; status: string; reason?: string; serials?: Record<string, string[]> }) => {
      const { error } = await supabase.rpc('set_online_order_status', {
        p_order: v.id, p_status: v.status, p_reason: v.reason ?? null, p_serials: v.serials ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setReason('')
      qc.invalidateQueries({ queryKey: ['online-orders'] })
      qc.invalidateQueries({ queryKey: ['stock'] })
    },
  })

  const wa = (phone: string) => `https://wa.me/${phone.startsWith('0') ? '20' + phone.slice(1) : phone}`

  return (
    <div>
      <PageHeader title="طلبات الموقع" subtitle="حجوزات العملاء من الموقع. أكّد مع العميل ثم جهّز وسلّم." />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`} placeholder="بحث بالرقم أو الاسم أو الهاتف" aria-label="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={`${inputCls} sm:w-56`} aria-label="الحالة" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="open">المفتوحة</option>
          <option value="all">الكل</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {q.isLoading && <State kind="loading" />}
      {q.isError && <State kind="error" text="تعذّر تحميل الطلبات." />}
      {q.data && rows.length === 0 && <State kind="empty" title="لا توجد طلبات" />}
      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted"><tr className="border-b border-line">
              {['الرقم', 'العميل', 'الاستلام', 'الإجمالي', 'الحالة', 'الوقت'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-bg" onClick={() => { setOpenId(o.id); move.reset(); setReason('') }}>
                  <td className="p-3 font-mono text-xs" dir="ltr">{o.order_number}</td>
                  <td className="p-3 font-medium" dir="auto">{o.customer_name}</td>
                  <td className="p-3">{o.fulfilment === 'pickup' ? 'من المحل' : 'توصيل'}</td>
                  <td className="whitespace-nowrap p-3">{formatEGP(toMinor(o.total))}</td>
                  <td className="p-3"><Chip tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Chip></td>
                  <td className="whitespace-nowrap p-3">{formatCairo(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={!!order} onClose={() => setOpenId(null)} title={order ? `طلب ${order.order_number}` : ''}
        footer={order && canAct && (
          <>
            <Button onClick={() => setOpenId(null)}>إغلاق</Button>
            {NEXT[order.status] && (
              <Button variant="primary" disabled={move.isPending || (NEXT[order.status]!.to === 'delivered' && !serialsOk)}
                onClick={() => move.mutate({ id: order.id, status: NEXT[order.status]!.to, serials: NEXT[order.status]!.to === 'delivered' ? serialsPayload : undefined })}>
                {NEXT[order.status]!.label}
              </Button>
            )}
          </>
        )}>
        {order && (
          <div className="space-y-4">
            <ErrorText error={move.error} />
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={STATUS[order.status].tone}>{STATUS[order.status].label}</Chip>
              {order.status === 'reserved' && <span className="text-xs text-muted">الحجز حتى {formatCairo(order.reserved_until)}</span>}
            </div>
            <div className="space-y-1 rounded-xl border border-line p-3 text-sm">
              <p className="font-semibold" dir="auto">{order.customer_name}</p>
              <p dir="ltr" className="text-start">
                {order.phone} ·{' '}
                <a className="underline" href={wa(order.phone)} target="_blank" rel="noopener noreferrer">واتساب</a>
              </p>
              <p>{order.fulfilment === 'pickup' ? 'استلام من المحل' : `توصيل إلى: ${order.address}`}</p>
              {order.notes && <p className="text-muted" dir="auto">ملاحظات: {order.notes}</p>}
            </div>
            <ul className="space-y-1 text-sm">
              {order.online_order_lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-2">
                  <span dir="auto">{l.name_snapshot} <span className="text-muted">× {l.qty}</span></span>
                  <span>{formatEGP(toMinor(l.unit_price) * l.qty)}</span>
                </li>
              ))}
              <li className="flex justify-between border-t border-line pt-2 font-bold"><span>الإجمالي</span><span>{formatEGP(toMinor(order.total))}</span></li>
            </ul>
            {order.status === 'ready' && trackedLines.length > 0 && (
              <div className="space-y-3 rounded-xl border border-warn/40 bg-warn/5 p-3">
                <p className="text-sm font-semibold">أدخل السيريال / IMEI لكل جهاز قبل التسليم</p>
                {trackedLines.map((l) => (
                  <label key={l.id} className="block space-y-1">
                    <span className="text-xs text-muted" dir="auto">{l.name_snapshot} — مطلوب {l.qty} ({parse(l.variant_id).length} مُدخل)</span>
                    <textarea className={`${inputCls} font-mono`} dir="ltr" rows={Math.min(l.qty + 1, 4)} placeholder="سطر لكل جهاز"
                      value={serialsText[l.variant_id] ?? ''} onChange={(e) => setSerialsText({ ...serialsText, [l.variant_id]: e.target.value })} />
                  </label>
                ))}
              </div>
            )}
            {order.status === 'cancelled' && <p className="text-sm text-muted">سبب الإلغاء: {order.cancel_reason}</p>}
            {canAct && ['reserved', 'confirmed', 'ready'].includes(order.status) && (
              <details className="rounded-xl border border-line p-3 text-sm">
                <summary className="cursor-pointer text-muted">إلغاء الطلب وتحرير الكمية</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input className={`${inputCls} flex-1`} placeholder="سبب الإلغاء *" dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button variant="danger" disabled={move.isPending || !reason.trim()} onClick={() => move.mutate({ id: order.id, status: 'cancelled', reason })}>تأكيد الإلغاء</Button>
                </div>
              </details>
            )}
            <p className="text-xs text-muted">عند "تم التسليم" تُخصم الكمية من المخزون تلقائيًا وتُسجَّل حركة بيع.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
