import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatCairo } from '../lib/time'
import { Button, Field, inputCls, Modal } from './ui'

type Approver = { id: string; full_name: string; role: string }
type Reply = { ok: boolean; token?: string; reason?: string; remaining?: number; until?: string }

const MSG: Record<string, string> = {
  wrong: 'الرقم السري غير صحيح.',
  locked: 'الرقم السري مقفل مؤقتاً بعد محاولات خاطئة.',
  throttled: 'محاولات كثيرة. انتظر 15 دقيقة.',
  no_pin: 'هذا المدير لم يضبط رقماً سرياً بعد.',
  invalid: 'بيانات غير صحيحة.',
}

/** Asks an owner/manager to approve an action by typing their PIN. Returns a one-time token (valid 5 minutes). */
export default function ApproverPin({
  open,
  onClose,
  reason,
  onToken,
}: {
  open: boolean
  onClose: () => void
  reason: string
  onToken: (token: string) => void
}) {
  const [who, setWho] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const approvers = useQuery({
    queryKey: ['approvers'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_approvers')
      if (error) throw error
      return data as Approver[]
    },
  })

  function cancel() {
    setPin('')
    setMsg('')
    onClose()
  }

  async function submit() {
    setBusy(true)
    setMsg('')
    const { data, error } = await supabase.rpc('request_override', { p_approver: who, p_pin: pin, p_reason: reason })
    setBusy(false)
    setPin('')
    if (error) {
      setMsg('تعذّر التحقق. حاول مرة أخرى.')
      return
    }
    const r = data as Reply
    if (r.ok && r.token) {
      onToken(r.token)
      return
    }
    let m = MSG[r.reason ?? 'invalid'] ?? MSG.invalid
    if (r.reason === 'wrong' && r.remaining != null) m += ` المتبقي ${r.remaining} محاولات.`
    if (r.reason === 'locked' && r.until) m += ` حتى ${formatCairo(r.until)}.`
    setMsg(m)
  }

  return (
    <Modal
      open={open}
      onClose={cancel}
      title="موافقة المدير"
      footer={
        <>
          <Button onClick={cancel}>إلغاء</Button>
          <Button variant="primary" disabled={busy || !who || pin.length < 6} onClick={submit}>
            {busy ? 'جارٍ التحقق…' : 'موافقة'}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">هذا الإجراء يحتاج موافقة المالك أو أحد المديرين: {reason}</p>
      {approvers.isError && <p role="alert" className="mb-3 text-sm text-danger">تعذّر تحميل قائمة المديرين.</p>}
      {approvers.data?.length === 0 && (
        <p role="alert" className="mb-3 text-sm text-warn">لا يوجد مدير ضبط رقماً سرياً بعد. يضبطه من صفحة «الأمان».</p>
      )}
      <div className="space-y-3">
        <Field label="المدير">
          <select className={inputCls} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">اختر…</option>
            {approvers.data?.map((a) => <option key={a.id} value={a.id}>{a.full_name || a.id.slice(0, 8)}</option>)}
          </select>
        </Field>
        <Field label="الرقم السري للمدير">
          <input
            className={inputCls}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && who && pin.length >= 6 && !busy && submit()}
          />
        </Field>
        {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
      </div>
    </Modal>
  )
}
