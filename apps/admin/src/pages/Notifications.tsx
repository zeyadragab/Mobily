import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { Kpi } from '../components/WalletBits'
import {
  KIND_LABEL, PRIORITY_LABEL, SEVERITY_TONE, refreshNotifications, useNotifications, useTasks, type TaskRow,
} from '../lib/notifications'
import { useTeam } from '../lib/people'
import { supabase } from '../lib/supabase'
import { cairoBusinessDate, cairoInstant, formatCairo } from '../lib/time'

const TASK_STATUS = { open: 'مفتوحة', done: 'تمت', cancelled: 'ملغاة' } as const

/** Alerts raised by the rules (low stock, shift difference, overdue installments, tax, suppliers, task reminders) and the to-do list. */
export default function Notifications() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const list = useNotifications()
  const tasks = useTasks()
  const [taskForm, setTaskForm] = useState(false)
  const [showClosed, setShowClosed] = useState(false)

  const refreshAll = async () => {
    await qc.invalidateQueries({ queryKey: ['notifications'] })
    await qc.invalidateQueries({ queryKey: ['tasks'] })
  }
  const rerun = useMutation({
    mutationFn: refreshNotifications,
    onSuccess: refreshAll,
  })
  const read = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('mark_notification_read', { p_id: id })
      if (error) throw error
    },
    onSuccess: refreshAll,
  })
  const readAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_all_notifications_read')
      if (error) throw error
    },
    onSuccess: refreshAll,
  })
  const closeTask = useMutation({
    mutationFn: async (v: { id: string; status: 'done' | 'cancelled' }) => {
      const { error } = await supabase.rpc('close_task', { p_task: v.id, p_status: v.status })
      if (error) throw error
    },
    onSuccess: refreshAll,
  })

  const alerts = list.data ?? []
  const unread = alerts.filter((n) => !n.read)
  const allTasks = tasks.data ?? []
  const openTasks = allTasks.filter((t) => t.status === 'open')
  const now = Date.now()
  const lateTasks = openTasks.filter((t) => t.remind_at && new Date(t.remind_at).getTime() <= now)
  const shownTasks = showClosed ? allTasks : openTasks

  return (
    <div>
      <PageHeader title="التنبيهات والمهام" subtitle="تنبيهات تلقائية من النظام (مخزون، ورديات، أقساط، ضريبة، موردين) وقائمة مهام بتذكير."
        actions={<>
          <Button disabled={rerun.isPending} onClick={() => rerun.mutate()}>{rerun.isPending ? 'جارٍ التحديث…' : 'تحديث التنبيهات'}</Button>
          <Button variant="primary" onClick={() => setTaskForm(true)}>مهمة جديدة</Button>
        </>} />
      <ErrorText error={rerun.error ?? read.error ?? readAll.error ?? closeTask.error} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="تنبيهات مفتوحة" value={String(alerts.length)} />
        <Kpi label="غير مقروءة" value={String(unread.length)} tone={unread.length ? 'warn' : undefined} />
        <Kpi label="مهام مفتوحة" value={String(openTasks.length)} />
        <Kpi label="مهام حان تذكيرها" value={String(lateTasks.length)} tone={lateTasks.length ? 'danger' : undefined} />
      </div>

      <section aria-labelledby="alerts-h" className="mb-8">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="alerts-h" className="text-base font-semibold">التنبيهات</h2>
          <Button small disabled={readAll.isPending || unread.length === 0} onClick={() => readAll.mutate()}>تحديد الكل كمقروء</Button>
        </div>
        {list.isLoading && <State kind="loading" />}
        {list.isError && <State kind="error" text="تعذّر تحميل التنبيهات." action={<Button onClick={() => void list.refetch()}>حاول تاني</Button>} />}
        {list.isSuccess && alerts.length === 0 && <State kind="empty" title="لا توجد تنبيهات" />}
        {alerts.length > 0 && <Card className="divide-y divide-line">
          {alerts.map((n) => (
            <div key={n.id} className={`flex flex-wrap items-start justify-between gap-3 p-3 text-sm ${n.read ? 'opacity-70' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <Chip tone={SEVERITY_TONE[n.severity]}>{KIND_LABEL[n.kind]}</Chip>
                  <span className={n.read ? '' : 'font-semibold'} dir="auto">{n.title}</span>
                </p>
                {n.body && <p className="mt-1 text-muted" dir="auto">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">{formatCairo(n.created_at)}</p>
              </div>
              <div className="flex gap-2">
                {n.link && <Link to={n.link} className="inline-flex items-center rounded-[10px] border border-line bg-surface px-3 py-1.5 text-xs font-medium shadow-soft hover:bg-bg">فتح</Link>}
                {!n.read && <Button small disabled={read.isPending} onClick={() => read.mutate(n.id)}>مقروء</Button>}
              </div>
            </div>
          ))}
        </Card>}
      </section>

      <section aria-labelledby="tasks-h">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="tasks-h" className="text-base font-semibold">المهام</h2>
          <Button small aria-pressed={showClosed} variant={showClosed ? 'primary' : 'ghost'} onClick={() => setShowClosed((v) => !v)}>إظهار المنتهية</Button>
        </div>
        {tasks.isLoading && <State kind="loading" />}
        {tasks.isError && <State kind="error" text="تعذّر تحميل المهام." action={<Button onClick={() => void tasks.refetch()}>حاول تاني</Button>} />}
        {tasks.isSuccess && shownTasks.length === 0 && <State kind="empty" title="لا توجد مهام" />}
        {shownTasks.length > 0 && <Card className="divide-y divide-line">
          {shownTasks.map((t) => <TaskLine key={t.id} t={t} pending={closeTask.isPending} onClose={(status) => closeTask.mutate({ id: t.id, status })} />)}
        </Card>}
      </section>

      {taskForm && <TaskForm canAssign={hasRole('owner', 'manager')} onClose={() => setTaskForm(false)}
        onDone={async () => { setTaskForm(false); await refreshNotifications().catch(() => undefined); await refreshAll() }} />}
    </div>
  )
}

function TaskLine({ t, pending, onClose }: { t: TaskRow; pending: boolean; onClose: (s: 'done' | 'cancelled') => void }) {
  const late = t.status === 'open' && !!t.remind_at && new Date(t.remind_at).getTime() <= Date.now()
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 p-3 text-sm ${t.status === 'open' ? '' : 'opacity-60'}`}>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <Chip tone={t.priority === 'high' ? 'danger' : t.priority === 'low' ? 'neutral' : 'warn'}>{PRIORITY_LABEL[t.priority]}</Chip>
          <span className="font-medium" dir="auto">{t.title}</span>
          {t.status !== 'open' && <Chip tone={t.status === 'done' ? 'ok' : 'neutral'}>{TASK_STATUS[t.status]}</Chip>}
          {late && <Chip tone="danger">حان الميعاد</Chip>}
        </p>
        {t.details && <p className="mt-1 text-muted" dir="auto">{t.details}</p>}
        {t.remind_at && <p className="mt-1 text-xs text-muted">تذكير: {formatCairo(t.remind_at)}</p>}
      </div>
      {t.status === 'open' && <div className="flex gap-2">
        <Button small variant="primary" disabled={pending} onClick={() => onClose('done')}>تمت</Button>
        <Button small variant="danger" disabled={pending} onClick={() => onClose('cancelled')}>إلغاء</Button>
      </div>}
    </div>
  )
}

function TaskForm({ canAssign, onClose, onDone }: { canAssign: boolean; onClose: () => void; onDone: () => void }) {
  const team = useTeam()
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [who, setWho] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('create_task', {
        p_title: title.trim(), p_details: details.trim() || null, p_priority: priority,
        p_remind_at: date ? cairoInstant(date, time) : null, p_assigned_to: who || null,
      })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  return (
    <Modal open onClose={onClose} title="مهمة جديدة"
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending || title.trim().length < 2} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</Button></>}>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorText error={save.error} /></div>
        <Field label="المهمة" className="sm:col-span-2"><input className={inputCls} dir="auto" autoFocus maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="تفاصيل" className="sm:col-span-2"><textarea className={inputCls} dir="auto" rows={2} maxLength={600} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
        <Field label="الأولوية">
          <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            {(['low', 'normal', 'high'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </Field>
        {canAssign && <Field label="المسؤول عنها">
          <select className={inputCls} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">أنا</option>
            {(team.data ?? []).filter((m) => m.is_active).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        </Field>}
        <Field label="تذكير في تاريخ (بتوقيت القاهرة)"><input className={inputCls} type="date" min={cairoBusinessDate()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="الساعة"><input className={inputCls} type="time" disabled={!date} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
