import { useMemo, useState } from 'react'
import { State } from '../components/State'
import { Button, Card, Chip, inputCls, PageHeader } from '../components/ui'
import { formatEGP, toMinor } from '../lib/money'
import { addDays, monthEnd, monthStart, REPORT_GROUPS, REPORTS, useReport, type ReportColumn, type ReportDef, type ReportTable } from '../lib/reports'
import { downloadCsv } from '../lib/repairs'
import { cairoBusinessDate } from '../lib/time'

const PRESETS = [
  { key: 'today', label: 'اليوم' },
  { key: 'week', label: 'آخر 7 أيام' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'last', label: 'الشهر الماضي' },
  { key: 'year', label: 'هذه السنة' },
  { key: 'custom', label: 'فترة محددة' },
] as const
type Preset = (typeof PRESETS)[number]['key']

function range(p: Preset, today: string): [string, string] {
  if (p === 'today') return [today, today]
  if (p === 'week') return [addDays(today, -6), today]
  if (p === 'month') return [monthStart(today), today]
  if (p === 'last') { const prev = addDays(monthStart(today), -1); return [monthStart(prev), monthEnd(prev)] }
  if (p === 'year') return [`${today.slice(0, 4)}-01-01`, today]
  return [monthStart(today), today]
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0))
const cell = (c: ReportColumn, v: string | number | null) => {
  if (v == null || v === '') return '—'
  if (c.type === 'money') return formatEGP(toMinor(num(v)))
  if (c.type === 'int') return String(num(v))
  return String(v)
}
const csvCell = (c: ReportColumn, v: string | number | null) => (v == null ? '' : c.type === 'money' || c.type === 'int' ? num(v) : String(v))
const TONE = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' } as const

/** Every report is rendered from the same shape: KPI cards and tables with CSV and print. */
export default function Reports() {
  const today = cairoBusinessDate()
  const [key, setKey] = useState('comprehensive')
  const [preset, setPreset] = useState<Preset>('month')
  const [custom, setCustom] = useState<[string, string]>([monthStart(today), today])
  const def = REPORTS.find((r) => r.key === key) ?? REPORTS[0]
  const [from, to] = preset === 'custom' ? custom : range(preset, today)
  const bad = def.ranged && (!from || !to || to < from)

  return (
    <div>
      <style>{`@media print { aside, header, nav, .no-print { display: none !important; } main { padding: 0 !important; } body { background: #fff !important; } }`}</style>
      <PageHeader title="التقارير" subtitle="كل الأرقام من قاعدة البيانات مباشرة وبتوقيت القاهرة. الربح هنا دفتري (على تاريخ البيع)."
        actions={<Button className="no-print" onClick={() => window.print()}>طباعة</Button>} />

      <div className="mb-4 grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Card className="no-print h-fit p-2">
          {REPORT_GROUPS.map((g) => (
            <div key={g} className="mb-2 last:mb-0">
              <p className="px-2 py-1 text-[11px] font-semibold text-muted">{g}</p>
              {REPORTS.filter((r) => r.group === g).map((r) => (
                <button key={r.key} onClick={() => setKey(r.key)} aria-current={r.key === key}
                  className={`block w-full rounded-[10px] px-3 py-2 text-start text-sm transition ${r.key === key ? 'bg-accent font-semibold text-accent-fg' : 'hover:bg-fg/[0.06]'}`}>
                  {r.title}
                </button>
              ))}
            </div>
          ))}
        </Card>

        <div>
          {def.ranged && <Card className="no-print mb-4 flex flex-wrap items-center gap-2 p-3">
            {PRESETS.map((p) => <Button key={p.key} small variant={preset === p.key ? 'primary' : 'ghost'} aria-pressed={preset === p.key} onClick={() => setPreset(p.key)}>{p.label}</Button>)}
            {preset === 'custom' && <>
              <input aria-label="من" type="date" className={`${inputCls} !w-40`} value={custom[0]} max={today} onChange={(e) => setCustom([e.target.value, custom[1]])} />
              <input aria-label="إلى" type="date" className={`${inputCls} !w-40`} value={custom[1]} max={today} onChange={(e) => setCustom([custom[0], e.target.value])} />
            </>}
            <span className="ms-auto text-xs text-muted"><bdi>{from}</bdi> ← <bdi>{to}</bdi></span>
          </Card>}
          <ReportBody def={def} from={from} to={to} bad={bad} />
        </div>
      </div>
    </div>
  )
}

function ReportBody({ def, from, to, bad }: { def: ReportDef; from: string; to: string; bad: boolean }) {
  const report = useReport(def, from, to, !bad)
  const data = report.data
  const stamp = useMemo(() => (def.ranged ? `${from}_${to}` : cairoBusinessDate()), [def.ranged, from, to])
  if (bad) return <State kind="error" title="الفترة غير صحيحة" text="اختر تاريخ بداية قبل تاريخ النهاية (حتى 400 يوم)." />
  return (
    <div>
      <h2 className="mb-1 text-lg font-bold">{def.title}</h2>
      <p className="mb-3 text-sm text-muted">{def.hint}</p>
      {report.isLoading && <State kind="loading" />}
      {report.isError && <State kind="error" text={report.error instanceof Error && /invalid range/.test(report.error.message) ? 'الفترة أطول من 400 يوم.' : 'تعذّر تحميل التقرير. تأكد من صلاحيتك أو حاول تاني.'}
        action={<Button onClick={() => void report.refetch()}>حاول تاني</Button>} />}
      {data && <>
        {data.kpis.length > 0 && <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
          {data.kpis.map((k) => (
            <Card key={k.label} className="p-4">
              <p className="text-xs text-muted">{k.label}</p>
              <p className={`mt-1 text-xl font-bold ${k.tone ? TONE[k.tone] : ''}`}>{k.kind === 'money' ? formatEGP(toMinor(num(k.value))) : String(num(k.value))}</p>
            </Card>
          ))}
        </div>}
        {data.tables.map((t, i) => <ReportTableView key={i} t={t} file={`${def.key}-${i + 1}-${stamp}.csv`} />)}
      </>}
    </div>
  )
}

function ReportTableView({ t, file }: { t: ReportTable; file: string }) {
  return (
    <Card className="mb-4 overflow-x-auto">
      <div className="flex items-center justify-between gap-2 p-4 pb-2">
        <h3 className="font-semibold">{t.title} <Chip>{t.rows.length}</Chip></h3>
        {t.rows.length > 0 && <Button small className="no-print" onClick={() => downloadCsv(file, t.columns.map((c) => c.label), t.rows.map((r) => t.columns.map((c) => csvCell(c, r[c.key]))))}>CSV</Button>}
      </div>
      {t.rows.length === 0 ? <p className="p-4 pt-0 text-sm text-muted">لا توجد بيانات.</p> : (
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr className="border-b border-line text-muted">
            {t.columns.map((c) => <th key={c.key} scope="col" className="p-3 text-start font-medium">{c.label}</th>)}
          </tr></thead>
          <tbody>{t.rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">
            {t.columns.map((c) => <td key={c.key} className="p-3" dir={c.type === 'text' ? 'auto' : undefined}>{c.type === 'date' || c.type === 'int' ? <bdi>{cell(c, r[c.key])}</bdi> : cell(c, r[c.key])}</td>)}
          </tr>)}</tbody>
        </table>
      )}
    </Card>
  )
}
