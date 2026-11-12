import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { ROLE_LABEL, type AppRole } from '../lib/roles'
import { formatCairo } from '../lib/time'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { State } from '../components/State'

type Staff = {
  id: string
  full_name: string
  email: string
  roles: AppRole[]
  is_active: boolean
  has_pin: boolean
  pin_locked_until: string | null
  force_logout_at: string | null
}
type SecEvent = {
  id: number
  occurred_at: string
  actor_id: string | null
  subject_id: string | null
  kind: string
  detail: { reason?: string } | null
}

const KIND: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  pin_failed: { label: 'رقم سري خاطئ', tone: 'warn' },
  pin_locked: { label: 'قفل الرقم السري', tone: 'danger' },
  pin_set: { label: 'تغيير الرقم السري', tone: 'info' },
  pin_unlocked: { label: 'فك قفل الرقم السري', tone: 'ok' },
  override_issued: { label: 'تصريح مدير', tone: 'info' },
  force_logout: { label: 'تسجيل خروج إجباري', tone: 'danger' },
}

function csv(rows: SecEvent[], name: (id: string | null) => string) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['الوقت', 'الحدث', 'المنفّذ', 'المستهدف', 'السبب']
  const lines = rows.map((r) =>
    [formatCairo(r.occurred_at), KIND[r.kind]?.label ?? r.kind, name(r.actor_id), name(r.subject_id), r.detail?.reason ?? ''].map(esc).join(','),
  )
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'security-events.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function Security() {
  const { hasRole } = useAuth()
  const isOwner = hasRole('owner')
  const canPin = hasRole('owner', 'manager')
  const canSeeEvents = hasRole('owner', 'accountant')
  const qc = useQueryClient()

  const staff = useQuery({
    queryKey: ['security', 'staff'],
    enabled: isOwner,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_staff_security')
      if (error) throw error
      return data as Staff[]
    },
  })
  const events = useQuery({
    queryKey: ['security', 'events'],
    enabled: canSeeEvents,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('security_events')
        .select('id,occurred_at,actor_id,subject_id,kind,detail')
        .order('occurred_at', { ascending: false })
        .limit(300)
      if (error) throw error
      return data as SecEvent[]
    },
  })

  const names = useMemo(() => new Map((staff.data ?? []).map((s) => [s.id, s.full_name || s.email])), [staff.data])
  const nameOf = (id: string | null) => (id ? names.get(id) ?? id.slice(0, 8) : '—')

  // ----- my PIN -----
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [pinErr, setPinErr] = useState<unknown>(null)
  const [pinOk, setPinOk] = useState(false)
  const setMyPin = useMutation({
    mutationFn: async () => {
      if (!/^[0-9]{6,8}$/.test(pin)) throw new Error('الرقم السري يجب أن يكون من 6 إلى 8 أرقام.')
      if (pin !== pin2) throw new Error('الرقمان غير متطابقين.')
      const { error } = await supabase.rpc('set_my_pin', { p_pin: pin })
      if (error) throw error
    },
    onSuccess: () => {
      setPin('')
      setPin2('')
      setPinErr(null)
      setPinOk(true)
      qc.invalidateQueries({ queryKey: ['security'] })
    },
    onError: (e) => {
      setPinOk(false)
      setPinErr(e)
    },
  })

  // ----- staff actions -----
  const [target, setTarget] = useState<Staff | null>(null)
  const [actErr, setActErr] = useState<unknown>(null)
  const done = () => {
    setTarget(null)
    setActErr(null)
    qc.invalidateQueries({ queryKey: ['security'] })
  }
  const forceOut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('force_logout_user', { p_user: id })
      if (error) throw error
    },
    onSuccess: done,
    onError: setActErr,
  })
  const unlock = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('unlock_pin', { p_user: id })
      if (error) throw error
    },
    onSuccess: done,
    onError: setActErr,
  })

  const [search, setSearch] = useState('')
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (events.data ?? []).filter(
      (r) => !s || [KIND[r.kind]?.label, r.kind, nameOf(r.actor_id), nameOf(r.subject_id)].some((v) => String(v ?? '').toLowerCase().includes(s)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.data, search, names])

  const locked = (s: Staff) => !!s.pin_locked_until && new Date(s.pin_locked_until) > new Date()

  return (
    <div>
      <PageHeader title="الأمان" subtitle="الرقم السري للمدير، إنهاء جلسات الموظفين، وسجل المحاولات المشبوهة." />

      {canPin && (
        <Card className="mb-5 p-5">
          <h2 className="mb-1 font-bold">رقمي السري للموافقات</h2>
          <p className="mb-4 text-sm text-muted">
            يكتبه الكاشير عند طلب موافقتك على خصم أو إجراء استثنائي. 6 إلى 8 أرقام. بعد 5 محاولات خاطئة يُقفل 15 دقيقة.
          </p>
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault()
              setMyPin.mutate()
            }}
          >
            <Field label="الرقم السري الجديد">
              <input className={inputCls} type="password" inputMode="numeric" autoComplete="new-password" dir="ltr" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="تأكيد الرقم السري">
              <input className={inputCls} type="password" inputMode="numeric" autoComplete="new-password" dir="ltr" maxLength={8} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="primary" disabled={setMyPin.isPending || pin.length < 6}>
                {setMyPin.isPending ? 'جارٍ الحفظ…' : 'حفظ الرقم السري'}
              </Button>
            </div>
          </form>
          <div className="mt-3">
            <ErrorText error={pinErr} />
            {pinOk && <p role="status" className="text-sm text-ok">تم حفظ الرقم السري.</p>}
          </div>
        </Card>
      )}

      {isOwner && (
        <Card className="mb-5 overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-bold">حسابات الفريق</h2>
            <p className="text-sm text-muted">«إنهاء الجلسة» يخرج الموظف فوراً من كل أجهزته ويطلب منه تسجيل الدخول من جديد.</p>
          </div>
          {staff.isLoading && <State kind="loading" />}
          {staff.isError && <State kind="error" text="تعذّر تحميل الحسابات." />}
          {staff.data && staff.data.length === 0 && <State kind="empty" title="لا توجد حسابات" />}
          {staff.data && staff.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted">
                  <tr className="border-b border-line">
                    {['الاسم', 'الأدوار', 'الرقم السري', 'آخر إنهاء جلسة', ''].map((h) => (
                      <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staff.data.map((s) => (
                    <tr key={s.id} className="border-b border-line last:border-0">
                      <td className="p-3">
                        <p className="font-medium" dir="auto">{s.full_name || '—'}</p>
                        <p className="text-xs text-muted" dir="ltr">{s.email}</p>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {s.roles.map((r) => <Chip key={r}>{ROLE_LABEL[r] ?? r}</Chip>)}
                          {!s.is_active && <Chip tone="danger">موقوف</Chip>}
                        </div>
                      </td>
                      <td className="p-3">
                        {locked(s) ? <Chip tone="danger">مقفل حتى {formatCairo(s.pin_locked_until!)}</Chip> : s.has_pin ? <Chip tone="ok">مفعّل</Chip> : <Chip>غير مضبوط</Chip>}
                      </td>
                      <td className="whitespace-nowrap p-3 text-muted">{s.force_logout_at ? formatCairo(s.force_logout_at) : '—'}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          {locked(s) && <Button small onClick={() => unlock.mutate(s.id)} disabled={unlock.isPending}>فك القفل</Button>}
                          <Button small variant="danger" onClick={() => setTarget(s)}>إنهاء الجلسة</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {canSeeEvents && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4">
            <h2 className="me-auto font-bold">سجل الأحداث الأمنية</h2>
            <input className={`${inputCls} !w-56`} placeholder="بحث" aria-label="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button small disabled={rows.length === 0} onClick={() => csv(rows, nameOf)}>تصدير CSV</Button>
          </div>
          {events.isLoading && <State kind="loading" />}
          {events.isError && <State kind="error" text="تعذّر تحميل السجل." />}
          {events.data && rows.length === 0 && <State kind="empty" title="لا توجد أحداث" text="لم تُسجَّل أي محاولات مشبوهة." />}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted">
                  <tr className="border-b border-line">
                    {['الوقت', 'الحدث', 'المنفّذ', 'المستهدف', 'السبب'].map((h) => (
                      <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="whitespace-nowrap p-3">{formatCairo(r.occurred_at)}</td>
                      <td className="p-3"><Chip tone={KIND[r.kind]?.tone ?? 'neutral'}>{KIND[r.kind]?.label ?? r.kind}</Chip></td>
                      <td className="p-3" dir="auto">{nameOf(r.actor_id)}</td>
                      <td className="p-3" dir="auto">{nameOf(r.subject_id)}</td>
                      <td className="p-3 text-muted" dir="auto">{r.detail?.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title="إنهاء جلسة موظف"
        footer={
          <>
            <Button onClick={() => setTarget(null)}>إلغاء</Button>
            <Button variant="danger" disabled={forceOut.isPending} onClick={() => target && forceOut.mutate(target.id)}>
              {forceOut.isPending ? 'جارٍ التنفيذ…' : 'إنهاء الجلسة الآن'}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          سيُسجَّل خروج <b dir="auto">{target?.full_name || target?.email}</b> من كل أجهزته. العملية تُسجَّل في السجل الأمني.
        </p>
        <div className="mt-3"><ErrorText error={actErr} /></div>
      </Modal>
    </div>
  )
}
