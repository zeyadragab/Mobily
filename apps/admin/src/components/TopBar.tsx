import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useOpenSession } from '../lib/data'
import { shiftLabel } from '../lib/drawers'
import { ACCENTS, useTheme } from '../lib/theme'
import { ROLE_LABEL } from '../lib/roles'

type Panel = 'bell' | 'tasks' | 'theme' | 'calc' | null

const BTN = 'relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface/80 text-fg/80 shadow-soft transition hover:bg-bg hover:text-fg active:scale-95'
const POP = 'absolute end-0 top-full z-40 mt-2 animate-rise rounded-2xl border border-line bg-surface p-3 shadow-window'

function Svg({ d, className = 'h-[18px] w-[18px]' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
const P = {
  bell: 'M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 19a2 2 0 0 0 4 0',
  tasks: 'M9 6h11M9 12h11M9 18h11M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2',
  palette: 'M12 3a9 9 0 1 0 0 18c1.4 0 2-1 1.5-2.2-.6-1.4.3-2.8 1.8-2.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01',
  calc: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01',
  refresh: 'M20 11a8 8 0 0 0-14.5-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.5 3.5L20 15M20 20v-5h-5',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  wifiOff: 'M3 3l18 18M2 9a15 15 0 0 1 4-2.6M9 5.2A15 15 0 0 1 22 9M5 12.5a10 10 0 0 1 3-1.9M15 10.8a10 10 0 0 1 4 1.7M8.5 16a5 5 0 0 1 3-1.5M12 19.5h.01',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
}

/** Counts shown on the bell and the tasks button. RLS decides what each role can count. */
function useCounts() {
  return useQuery({
    queryKey: ['topbar', 'counts'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [a, p] = await Promise.all([
        supabase.from('shift_alerts').select('id', { count: 'exact', head: true }).is('reviewed_at', null),
        supabase.from('approval_requests').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
      ])
      return { alerts: a.count ?? 0, approvals: p.count ?? 0 }
    },
  })
}

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' })

function wxGlyph(code: number) {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 48) return '🌫️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '❄️'
  return '⛈️'
}

/** Cairo temperature from open-meteo (no key, no personal data). Cached 30 minutes; the pill hides if it cannot load. */
function useWeather() {
  return useQuery({
    queryKey: ['topbar', 'weather'],
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=30.04&longitude=31.24&current=temperature_2m,weather_code')
      if (!r.ok) throw new Error('weather')
      const j = (await r.json()) as { current?: { temperature_2m?: number; weather_code?: number } }
      if (typeof j.current?.temperature_2m !== 'number') throw new Error('weather')
      return { temp: Math.round(j.current.temperature_2m), code: j.current.weather_code ?? 0 }
    },
  })
}

function ClockPill() {
  const [now, setNow] = useState(() => new Date())
  const wx = useWeather()
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="pointer-events-none absolute left-1/2 top-0 hidden -translate-x-1/2 md:block" dir="ltr">
      <div className="pointer-events-auto flex items-center gap-3 rounded-b-[20px] bg-[#2c2c2e] px-5 py-2 text-sm font-semibold text-white shadow-window">
        <span aria-label="الوقت بتوقيت القاهرة">{timeFmt.format(now)}</span>
        {wx.data && (
          <>
            <span aria-hidden="true" className="h-4 w-px bg-white/25" />
            <span title="الطقس في القاهرة">{wxGlyph(wx.data.code)} {wx.data.temp}°</span>
          </>
        )}
      </div>
    </div>
  )
}

function useOnline() {
  const [on, setOn] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return on
}

function Badge({ n, tone = 'bg-accent' }: { n: number; tone?: string }) {
  if (n <= 0) return null
  return <span className={`absolute -end-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${tone}`}>{n > 99 ? '99+' : n}</span>
}

const OPS = { '+': (a: number, b: number) => a + b, '-': (a: number, b: number) => a - b, '×': (a: number, b: number) => a * b, '÷': (a: number, b: number) => (b === 0 ? NaN : a / b) } as const
type Op = keyof typeof OPS

function Calculator() {
  const [cur, setCur] = useState('0')
  const [acc, setAcc] = useState<number | null>(null)
  const [op, setOp] = useState<Op | null>(null)
  const [fresh, setFresh] = useState(true)
  const num = (s: string) => Number(s)
  const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1e10) / 1e10) : 'خطأ')

  function digit(d: string) {
    if (cur === 'خطأ') { setCur(d === '.' ? '0.' : d); setFresh(false); return }
    if (d === '.' && !fresh && cur.includes('.')) return
    if (fresh) { setCur(d === '.' ? '0.' : d); setFresh(false) } else setCur(cur.length < 14 ? cur + d : cur)
  }
  function operate(next: Op | null) {
    if (cur === 'خطأ') return
    const v = num(cur)
    const res = acc !== null && op && !fresh ? OPS[op](acc, v) : v
    setAcc(Number.isFinite(res) ? res : null); setCur(fmt(res)); setOp(next); setFresh(true)
    if (!next) setAcc(null)
  }
  function clear() { setCur('0'); setAcc(null); setOp(null); setFresh(true) }
  function back() { if (!fresh && cur.length > 1 && cur !== 'خطأ') setCur(cur.slice(0, -1)); else if (!fresh) { setCur('0'); setFresh(true) } }

  const keys: [string, () => void, string?][] = [
    ['C', clear, 'text-danger'], ['⌫', back], ['%', () => setCur(fmt(num(cur) / 100))], ['÷', () => operate('÷'), 'text-accent'],
    ['7', () => digit('7')], ['8', () => digit('8')], ['9', () => digit('9')], ['×', () => operate('×'), 'text-accent'],
    ['4', () => digit('4')], ['5', () => digit('5')], ['6', () => digit('6')], ['-', () => operate('-'), 'text-accent'],
    ['1', () => digit('1')], ['2', () => digit('2')], ['3', () => digit('3')], ['+', () => operate('+'), 'text-accent'],
    ['0', () => digit('0')], ['.', () => digit('.')], ['±', () => setCur(cur === '0' || cur === 'خطأ' ? cur : cur.startsWith('-') ? cur.slice(1) : '-' + cur)], ['=', () => operate(null), 'bg-accent !text-accent-fg'],
  ]
  return (
    <div className="w-64" dir="ltr">
      <div className="mb-2 rounded-xl bg-bg px-3 py-2 text-end">
        <p className="h-4 text-xs text-muted">{acc !== null && op ? `${fmt(acc)} ${op}` : ''}</p>
        <p className="truncate text-2xl font-bold tabular-nums" aria-live="polite">{cur}</p>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {keys.map(([k, fn, cls]) => (
          <button key={k} type="button" onClick={fn}
            className={`h-10 rounded-[10px] border border-line bg-surface text-sm font-semibold shadow-soft transition hover:bg-bg active:scale-95 ${cls ?? ''}`}>{k}</button>
        ))}
      </div>
    </div>
  )
}

function Popover({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  if (!open) return null
  return (
    <div className={POP} role="dialog" aria-label={label} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      {children}
    </div>
  )
}

/** Red banner above every page while a shift difference is waiting for a manager's review. */
export function AlertBanner() {
  const counts = useCounts()
  const n = counts.data?.alerts ?? 0
  if (n === 0) return null
  return (
    <div role="alert" className="mx-auto mb-4 flex max-w-6xl flex-wrap items-center justify-between gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      <span className="font-semibold">تنبيهات عجز الورديات: {n} تنتظر المراجعة</span>
      <Link to="/accounts" className="font-semibold underline underline-offset-4">عرض التنبيهات ‹</Link>
    </div>
  )
}

export default function TopBar() {
  const { fullName, roles, hasRole } = useAuth()
  const qc = useQueryClient()
  const theme = useTheme()
  const online = useOnline()
  const canShift = hasRole('owner', 'manager', 'cashier')
  const session = useOpenSession(canShift)
  const counts = useCounts()
  const spinning = useIsFetching() > 0
  const [panel, setPanel] = useState<Panel>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!panel) return
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setPanel(null) }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(null)
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [panel])

  const alerts = counts.data?.alerts ?? 0
  const approvals = counts.data?.approvals ?? 0
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p))
  const open = !!session.data

  return (
    <div className="sticky top-0 z-20 hidden border-b border-line/70 bg-surface/70 backdrop-blur-2xl backdrop-saturate-150 lg:block">
      <div className="relative flex min-h-[58px] items-center justify-between gap-3 px-8 py-2" ref={box}>
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
          <span className="truncate" dir="auto">{fullName}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{roles.map((r) => ROLE_LABEL[r]).join('، ')}</span>
        </div>

        <ClockPill />

        <div className="flex items-center gap-2">
          <div className="relative">
            <button type="button" className={BTN} aria-label="التنبيهات" aria-expanded={panel === 'bell'} onClick={() => toggle('bell')}>
              <Svg d={P.bell} />
              {alerts > 0 && <span className="absolute -end-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-danger" />}
            </button>
            <Popover open={panel === 'bell'} onClose={() => setPanel(null)} label="التنبيهات">
              <div className="w-72 space-y-1 text-sm">
                <p className="px-1 pb-1 font-semibold">التنبيهات</p>
                {alerts === 0 && <p className="px-1 py-3 text-center text-muted">لا توجد تنبيهات جديدة.</p>}
                {alerts > 0 && (
                  <Link to="/accounts" onClick={() => setPanel(null)} className="flex items-center justify-between rounded-xl bg-danger/10 px-3 py-2 text-danger hover:bg-danger/15">
                    <span>تنبيهات عجز الورديات</span><b>{alerts}</b>
                  </Link>
                )}
              </div>
            </Popover>
          </div>

          <div className="relative">
            <button type="button" className={BTN} aria-label="المهام والموافقات" aria-expanded={panel === 'tasks'} onClick={() => toggle('tasks')}>
              <Svg d={P.tasks} />
              <Badge n={approvals} />
            </button>
            <Popover open={panel === 'tasks'} onClose={() => setPanel(null)} label="المهام">
              <div className="w-72 space-y-1 text-sm">
                <p className="px-1 pb-1 font-semibold">المهام</p>
                {approvals === 0 && <p className="px-1 py-3 text-center text-muted">لا توجد طلبات موافقة معلّقة.</p>}
                {approvals > 0 && (
                  <Link to="/approvals" onClick={() => setPanel(null)} className="flex items-center justify-between rounded-xl bg-accent/10 px-3 py-2 hover:bg-accent/15">
                    <span>طلبات موافقة تنتظر القرار</span><b>{approvals}</b>
                  </Link>
                )}
              </div>
            </Popover>
          </div>

          {canShift && (
            <div className="flex items-center gap-3 rounded-full bg-[#1c1c1e] px-4 py-2 text-xs font-semibold text-white shadow-soft">
              <Link to="/cash" className="flex items-center gap-2 hover:opacity-80" title="الورديات والأدراج">
                <span className={`h-2 w-2 rounded-full ${open ? 'bg-[#30d158]' : 'bg-[#ff453a]'}`} />
                <span className={open ? 'text-[#30d158]' : 'text-[#ffb340]'}>
                  {open ? <>الوردية مفتوحة <bdi className="opacity-70">{shiftLabel(session.data?.shift_no)}</bdi></> : 'الوردية مغلقة'}
                </span>
              </Link>
              <span aria-hidden="true" className="h-3.5 w-px bg-white/25" />
              <span title={online ? 'متصل بالإنترنت' : 'لا يوجد اتصال'} className={online ? 'text-[#30d158]' : 'text-[#ff453a]'}>
                <Svg d={online ? P.wifi : P.wifiOff} className="h-4 w-4" />
                <span className="sr-only">{online ? 'متصل' : 'غير متصل'}</span>
              </span>
              <span aria-hidden="true" className="h-3.5 w-px bg-white/25" />
              <Link to="/sales" title="فاتورة جديدة" className="text-[#ffb340] hover:opacity-80"><Svg d={P.bolt} className="h-4 w-4" /><span className="sr-only">فاتورة جديدة</span></Link>
            </div>
          )}

          <div className="relative">
            <button type="button" className={`${BTN} !w-auto gap-2 px-3`} aria-label="المظهر" aria-expanded={panel === 'theme'} onClick={() => toggle('theme')}>
              <Svg d={P.palette} />
              <span className="h-3 w-3 rounded-full" style={{ background: theme.accent }} />
            </button>
            <Popover open={panel === 'theme'} onClose={() => setPanel(null)} label="المظهر">
              <div className="w-60 space-y-3 text-sm">
                <button type="button" onClick={theme.toggle} aria-pressed={theme.dark}
                  className="flex w-full items-center justify-between rounded-xl border border-line px-3 py-2 transition hover:bg-bg active:scale-[0.98]">
                  <span>{theme.dark ? 'الوضع الداكن' : 'الوضع الفاتح'}</span>
                  <Svg d={theme.dark ? P.moon : P.sun} />
                </button>
                <div>
                  <p className="mb-1.5 text-xs text-muted">لون النظام</p>
                  <div className="flex gap-2" role="radiogroup" aria-label="لون النظام">
                    {ACCENTS.map((a) => (
                      <button key={a.key} type="button" role="radio" aria-checked={theme.accent === a.color} aria-label={a.label} title={a.label}
                        onClick={() => theme.setAccent(a.color)}
                        className={`h-7 w-7 rounded-full border-2 transition active:scale-90 ${theme.accent === a.color ? 'border-fg' : 'border-transparent'}`}
                        style={{ background: a.color }} />
                    ))}
                  </div>
                </div>
              </div>
            </Popover>
          </div>

          <div className="relative">
            <button type="button" className={BTN} aria-label="الآلة الحاسبة" aria-expanded={panel === 'calc'} onClick={() => toggle('calc')}>
              <Svg d={P.calc} />
            </button>
            <Popover open={panel === 'calc'} onClose={() => setPanel(null)} label="الآلة الحاسبة"><Calculator /></Popover>
          </div>

          <button type="button" onClick={() => void qc.invalidateQueries()} aria-label="تحديث البيانات"
            className="flex h-9 items-center gap-2 rounded-full border border-line bg-surface/80 px-4 text-sm text-fg/80 shadow-soft transition hover:bg-bg hover:text-fg active:scale-95">
            <Svg d={P.refresh} className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>
      </div>
    </div>
  )
}

