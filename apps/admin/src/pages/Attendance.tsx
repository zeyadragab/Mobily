import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, Field, inputCls, Modal, PageHeader } from '../components/ui'
import { Kpi } from '../components/WalletBits'
import { useAttendance, useAttendanceEmployees, type AttendanceRow } from '../lib/people'
import { downloadCsv } from '../lib/repairs'
import { supabase } from '../lib/supabase'
import { cairoBusinessDate, cairoClock, cairoInstant, hoursMinutes } from '../lib/time'

const worked = (r: AttendanceRow) => (r.check_in && r.check_out ? (new Date(r.check_out).getTime() - new Date(r.check_in).getTime()) / 60000 : 0)
const nextDay = (d: string) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10) }
const dayName = (d: string) => new Intl.DateTimeFormat('ar-EG', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))

/** Check in / out in Cairo time. Lateness, early leave and overtime are computed by the database against the planned shift. */
export default function Attendance() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const boss = hasRole('owner', 'manager')
  const today = cairoBusinessDate()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [who, setWho] = useState('')
  const employees = useAttendanceEmployees()
  const records = useAttendance(month)
  const [edit, setEdit] = useState<{ employee: string; row: AttendanceRow | null } | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['attendance'] })
  const check = useMutation({
    mutationFn: async (v: { employee: string; action: 'in' | 'out' }) => {
      const { error } = await supabase.rpc('attendance_check', { p_employee: v.employee, p_action: v.action })
      if (error) throw error
    },
    onSuccess: refresh,
  })

  const list = (employees.data ?? []).filter((e) => e.is_active)
  const nameOf = (id: string) => employees.data?.find((e) => e.id === id)?.name ?? '—'
  const rows = (records.data ?? []).filter((r) => !who || r.employee_id === who)

  const summary = useMemo(() => list.map((e) => {
    const rs = (records.data ?? []).filter((r) => r.employee_id === e.id)
    return {
      e, days: rs.filter((r) => r.check_in).length, minutes: rs.reduce((s, r) => s + worked(r), 0),
      late: rs.reduce((s, r) => s + r.late_minutes, 0), lateDays: rs.filter((r) => r.late_minutes > 0).length,
      early: rs.reduce((s, r) => s + r.early_leave_minutes, 0), ot: rs.reduce((s, r) => s + r.overtime_minutes, 0),
      open: rs.filter((r) => r.check_in && !r.check_out).length,
    }
  }), [list, records.data])

  const todayRec = (id: string) => (records.data ?? []).find((r) => r.employee_id === id && r.work_date === today)
  const openRec = (id: string) => (records.data ?? []).find((r) => r.employee_id === id && r.check_in && !r.check_out)
  const presentNow = list.filter((e) => openRec(e.id)).length

  return (
    <div>
      <PageHeader title="الحضور والانصراف" subtitle="بتوقيت القاهرة. التأخير والانصراف المبكر والإضافي بيتحسبوا من مواعيد الوردية (10 صباحًا - 10 مساءً افتراضيًا)."
        actions={<>
          <input aria-label="الشهر" type="month" className={`${inputCls} !w-44`} value={month} max={today.slice(0, 7)} onChange={(e) => setMonth(e.target.value || today.slice(0, 7))} />
          <Button onClick={() => downloadCsv(`attendance-${month}.csv`, ['التاريخ', 'الموظف', 'حضور', 'انصراف', 'ساعات', 'تأخير (د)', 'انصراف مبكر (د)', 'إضافي (د)', 'ملاحظة'],
            rows.map((r) => [r.work_date, nameOf(r.employee_id), cairoClock(r.check_in), cairoClock(r.check_out), hoursMinutes(worked(r)), r.late_minutes, r.early_leave_minutes, r.overtime_minutes, r.note]))}>تصدير CSV</Button>
        </>} />
      <ErrorText error={check.error} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="حاضرون الآن" value={String(presentNow)} tone={presentNow ? 'ok' : undefined} />
        <Kpi label="أيام حضور الشهر" value={String(summary.reduce((s, x) => s + x.days, 0))} />
        <Kpi label="دقائق التأخير" value={String(summary.reduce((s, x) => s + x.late, 0))} tone={summary.some((x) => x.late) ? 'warn' : undefined} />
        <Kpi label="إضافي (ساعة:دقيقة)" value={hoursMinutes(summary.reduce((s, x) => s + x.ot, 0))} />
      </div>

      {employees.isLoading && <State kind="loading" />}
      {employees.isError && <State kind="error" text="تعذّر تحميل الموظفين." action={<Button onClick={() => void employees.refetch()}>حاول تاني</Button>} />}
      {employees.isSuccess && list.length === 0 && <State kind="empty" title="لا يوجد موظفون" text={boss ? 'أضف موظفين من صفحة حسابات الموظفين.' : 'حسابك غير مربوط بموظف. اطلب من المدير ربطه.'} />}

      {list.length > 0 && <Card className="mb-4 overflow-x-auto">
        <h2 className="p-4 pb-0 font-semibold">النهارده</h2>
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-line text-muted">
            {['الموظف', 'حضور', 'انصراف', 'الحالة', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h}</th>)}
          </tr></thead>
          <tbody>{list.filter((e) => boss || e.is_me).map((e) => {
            const open = openRec(e.id)
            const t = open ?? todayRec(e.id)
            return <tr key={e.id} className="border-b border-line last:border-0">
              <td className="p-3" dir="auto">{e.name}{e.is_me && <span className="ms-2"><Chip tone="info">أنا</Chip></span>}</td>
              <td className="p-3"><bdi>{cairoClock(t?.check_in ?? null) || '—'}</bdi></td>
              <td className="p-3"><bdi>{cairoClock(t?.check_out ?? null) || '—'}</bdi></td>
              <td className="p-3">{open ? <Chip tone="ok">حاضر</Chip> : t?.check_out ? <Chip>انصرف</Chip> : <Chip tone="warn">لم يحضر</Chip>}</td>
              <td className="p-3"><div className="flex gap-2">
                {!open && !t?.check_in && <Button small variant="primary" disabled={check.isPending} onClick={() => check.mutate({ employee: e.id, action: 'in' })}>تسجيل حضور</Button>}
                {open && <Button small variant="danger" disabled={check.isPending} onClick={() => check.mutate({ employee: e.id, action: 'out' })}>تسجيل انصراف</Button>}
              </div></td>
            </tr>
          })}</tbody>
        </table>
      </Card>}

      {boss && summary.length > 0 && <Card className="mb-4 overflow-x-auto">
        <h2 className="p-4 pb-0 font-semibold">ملخص الشهر</h2>
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-line text-muted">
            {['الموظف', 'أيام الحضور', 'ساعات العمل', 'تأخير (د)', 'أيام التأخير', 'انصراف مبكر (د)', 'إضافي', 'بدون انصراف'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}
          </tr></thead>
          <tbody>{summary.map((s) => <tr key={s.e.id} className="border-b border-line last:border-0">
            <td className="p-3" dir="auto">{s.e.name}</td><td className="p-3">{s.days}</td><td className="p-3">{hoursMinutes(s.minutes)}</td>
            <td className="p-3">{s.late ? <Chip tone="warn">{s.late}</Chip> : 0}</td><td className="p-3">{s.lateDays}</td><td className="p-3">{s.early}</td>
            <td className="p-3">{hoursMinutes(s.ot)}</td><td className="p-3">{s.open ? <Chip tone="danger">{s.open}</Chip> : 0}</td>
          </tr>)}</tbody>
        </table>
      </Card>}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">السجل</h2>
        {boss && <select aria-label="الموظف" className={`${inputCls} !w-56`} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">كل الموظفين</option>{list.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>}
        {boss && list.length > 0 && <Button small onClick={() => setEdit({ employee: who || list[0].id, row: null })}>إضافة / تعديل يوم</Button>}
      </div>
      {records.isLoading && <State kind="loading" />}
      {records.isError && <State kind="error" text="تعذّر تحميل السجل." action={<Button onClick={() => void records.refetch()}>حاول تاني</Button>} />}
      {records.isSuccess && rows.length === 0 && <State kind="empty" title="لا توجد سجلات في هذا الشهر" />}
      {rows.length > 0 && <Card className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b border-line text-muted">
          {['اليوم', 'الموظف', 'حضور', 'انصراف', 'ساعات', 'تأخير', 'مبكر', 'إضافي', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h}</th>)}
        </tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className="border-b border-line last:border-0">
          <td className="p-3"><bdi>{r.work_date}</bdi><p className="text-xs text-muted">{dayName(r.work_date)}</p></td>
          <td className="p-3" dir="auto">{nameOf(r.employee_id)}{r.note && <p className="text-xs text-muted">{r.note}</p>}</td>
          <td className="p-3"><bdi>{cairoClock(r.check_in) || '—'}</bdi></td>
          <td className="p-3"><bdi>{cairoClock(r.check_out) || (r.check_in ? <Chip tone="danger">مفتوح</Chip> : '—')}</bdi></td>
          <td className="p-3">{r.check_out ? hoursMinutes(worked(r)) : '—'}</td>
          <td className="p-3">{r.late_minutes ? <Chip tone="warn">{r.late_minutes} د</Chip> : '—'}</td>
          <td className="p-3">{r.early_leave_minutes ? `${r.early_leave_minutes} د` : '—'}</td>
          <td className="p-3">{r.overtime_minutes ? `${r.overtime_minutes} د` : '—'}</td>
          <td className="p-3">{boss && <Button small onClick={() => setEdit({ employee: r.employee_id, row: r })}>تعديل</Button>}</td>
        </tr>)}</tbody>
      </table></Card>}

      {edit && <DayDialog employees={list} initial={edit} onClose={() => setEdit(null)} onDone={async () => { setEdit(null); await refresh() }} />}
    </div>
  )
}

function DayDialog({ employees, initial, onClose, onDone }: {
  employees: { id: string; name: string }[]; initial: { employee: string; row: AttendanceRow | null }; onClose: () => void; onDone: () => void
}) {
  const r = initial.row
  const [employee, setEmployee] = useState(initial.employee)
  const [date, setDate] = useState(r?.work_date ?? cairoBusinessDate())
  const [inT, setInT] = useState(cairoClock(r?.check_in ?? null))
  const [outT, setOutT] = useState(cairoClock(r?.check_out ?? null))
  const [s1, setS1] = useState(r?.shift_start.slice(0, 5) ?? '10:00')
  const [s2, setS2] = useState(r?.shift_end.slice(0, 5) ?? '22:00')
  const [note, setNote] = useState(r?.note ?? '')
  const save = useMutation({
    mutationFn: async () => {
      if (outT && !inT) throw new Error('اكتب وقت الحضور قبل الانصراف.')
      const pin = inT ? cairoInstant(date, inT) : null
      // an out time earlier than the in time means the shift passed midnight
      const pout = outT ? cairoInstant(inT && outT <= inT ? nextDay(date) : date, outT) : null
      const { error } = await supabase.rpc('save_attendance', {
        p_employee: employee, p_date: date, p_in: pin, p_out: pout, p_shift_start: s1, p_shift_end: s2, p_note: note.trim(),
      })
      if (error) throw error
    },
    onSuccess: onDone,
  })
  return (
    <Modal open onClose={onClose} title="تعديل يوم حضور"
      footer={<><Button onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</Button></>}>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2"><ErrorText error={save.error} /></div>
        <Field label="الموظف"><select className={inputCls} value={employee} onChange={(e) => setEmployee(e.target.value)}>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
        <Field label="اليوم"><input className={inputCls} type="date" max={cairoBusinessDate()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="وقت الحضور"><input className={inputCls} type="time" value={inT} onChange={(e) => setInT(e.target.value)} /></Field>
        <Field label="وقت الانصراف"><input className={inputCls} type="time" value={outT} onChange={(e) => setOutT(e.target.value)} /></Field>
        <Field label="بداية الوردية"><input className={inputCls} type="time" value={s1} onChange={(e) => setS1(e.target.value)} /></Field>
        <Field label="نهاية الوردية"><input className={inputCls} type="time" value={s2} onChange={(e) => setS2(e.target.value)} /></Field>
        <Field label="السبب (إلزامي)" hint="سيب الحضور والانصراف فاضيين لتسجيل يوم إجازة." className="sm:col-span-2">
          <input className={inputCls} dir="auto" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
