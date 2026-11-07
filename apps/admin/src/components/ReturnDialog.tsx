import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useSettings } from '../lib/settings'
import { METHOD_AR, type Method } from '../lib/data'
import { formatEGP, toMinor } from '../lib/money'
import { Button, ErrorText, Field, inputCls, Modal } from './ui'

export type ReturnableInvoice = {
  id: string
  invoice_number: string
  subtotal: string
  total: string
  sales_invoice_lines: { id: string; name_snapshot: string; qty: number; unit_price: string; serials: string[] | null }[]
  sales_payments: { method: Method }[]
}

type PastReturn = { id: string; status: string; sales_return_lines: { invoice_line_id: string; qty: number; serials: string[] | null }[] }

export default function ReturnDialog({ inv, onClose }: { inv: ReturnableInvoice; onClose: () => void }) {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const settings = useSettings()
  const [qty, setQty] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState<Method>(inv.sales_payments[0]?.method ?? 'cash')
  const [err, setErr] = useState<unknown>(null)

  const past = useQuery({
    queryKey: ['returns-of', inv.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales_returns').select('id,status,sales_return_lines(invoice_line_id,qty,serials)').eq('invoice_id', inv.id)
      if (error) throw error
      return data as unknown as PastReturn[]
    },
  })

  const pastLines = (lineId: string) =>
    (past.data ?? []).filter((r) => r.status !== 'rejected').flatMap((r) => r.sales_return_lines).filter((l) => l.invoice_line_id === lineId)
  const returned = (lineId: string) => pastLines(lineId).reduce((s, l) => s + l.qty, 0)
  const returnedSerials = (lineId: string) => new Set(pastLines(lineId).flatMap((l) => l.serials ?? []))

  const ratio = toMinor(inv.subtotal) > 0 ? toMinor(inv.total) / toMinor(inv.subtotal) : 1
  const chosen = inv.sales_invoice_lines
    .map((l) => ({ l, q: l.serials ? (picked[l.id]?.length ?? 0) : Math.min(parseInt(qty[l.id] || '0', 10) || 0, l.qty - returned(l.id)) }))
    .filter((x) => x.q > 0)
  const refund = Math.round(chosen.reduce((s, x) => s + x.q * toMinor(x.l.unit_price) * ratio, 0))
  const threshold = (settings.data?.return_approval_threshold ?? 2000) * 100
  const needsApproval = !hasRole('owner') && (!hasRole('manager') || refund >= threshold)

  const save = useMutation({
    mutationFn: async () => {
      if (chosen.length === 0) throw new Error('حدد كمية مرتجعة لصنف واحد على الأقل.')
      if (!reason.trim()) throw new Error('سبب المرتجع مطلوب.')
      const { error } = await supabase.rpc('create_return', {
        p_invoice: inv.id,
        p_lines: chosen.map((x) => (x.l.serials ? { invoice_line_id: x.l.id, serials: picked[x.l.id] } : { invoice_line_id: x.l.id, qty: x.q })),
        p_reason: reason.trim(),
        p_method: method,
      })
      if (error) throw error
    },
    onSuccess: () => {
      ;['sales', 'returns-of', 'approvals', 'cash', 'transactions', 'inspection', 'devices'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      onClose()
    },
    onError: setErr,
  })

  return (
    <Modal open onClose={onClose} title={`مرتجع من فاتورة ${inv.invoice_number}`}
      footer={<>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="primary" disabled={save.isPending || chosen.length === 0} onClick={() => { setErr(null); save.mutate() }}>
          {save.isPending ? 'جارٍ الحفظ…' : needsApproval ? 'إرسال للمالك للموافقة' : 'تسجيل المرتجع'}
        </Button>
      </>}>
      <div className="space-y-4">
        <ErrorText error={err} />
        <ul className="space-y-2">
          {inv.sales_invoice_lines.map((l) => {
            const left = l.qty - returned(l.id)
            const done = returnedSerials(l.id)
            return (
              <li key={l.id} className="space-y-2 rounded-xl border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1" dir="auto">{l.name_snapshot} <span className="text-muted">— بيع {l.qty}، متاح للإرجاع {left}</span></span>
                  {!l.serials && (
                    <input aria-label="الكمية المرتجعة" className={`${inputCls} !w-20`} dir="ltr" inputMode="numeric" disabled={left <= 0}
                      placeholder="0" value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
                  )}
                </div>
                {l.serials && (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="الأجهزة المرتجعة">
                    {l.serials.map((s) => {
                      const on = picked[l.id]?.includes(s) ?? false
                      const disabled = done.has(s)
                      return (
                        <label key={s} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs ${on ? 'border-accent bg-accent text-accent-fg' : 'border-line'} ${disabled ? 'opacity-40' : ''}`} dir="ltr">
                          <input type="checkbox" className="sr-only" disabled={disabled} checked={on}
                            onChange={(e) => setPicked({ ...picked, [l.id]: e.target.checked ? [...(picked[l.id] ?? []), s] : (picked[l.id] ?? []).filter((x) => x !== s) })} />
                          {s}{disabled && ' (مرتجع)'}
                        </label>
                      )
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="سبب المرتجع *"><input className={inputCls} dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="طريقة رد المبلغ">
            <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              {Object.entries(METHOD_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
        <div className="rounded-xl bg-bg p-4 text-sm">
          <p className="flex justify-between text-base font-bold"><span>المبلغ المسترد</span><span>{formatEGP(refund)}</span></p>
          <p className="mt-1 text-xs text-muted">يُحسب بنفس نسبة الخصم على الفاتورة. القطعة المرتجعة تذهب للفحص ولا تعود للبيع قبل اعتمادها.</p>
        </div>
        {needsApproval && (
          <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            هذا المرتجع يحتاج موافقة المالك. لن يُرد المبلغ ولن يخرج من الدرج قبل موافقته.
          </p>
        )}
        {method === 'cash' && <p className="text-xs text-muted">الرد النقدي يحتاج درجًا مفتوحًا ويُخصم من النقدية المتوقعة.</p>}
      </div>
    </Modal>
  )
}
