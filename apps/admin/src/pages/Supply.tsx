import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { formatEGP, toMinor } from '../lib/money'
import { downloadCsv } from '../lib/repairs'
import { Card, Chip, PageHeader } from '../components/ui'
import { State } from '../components/State'
import SupplyWizard from '../components/SupplyWizard'
import StockCount from '../components/StockCount'
import { DamagedTab, ShortageTab } from '../components/DamagedShortage'

type Tab = 'new' | 'log' | 'damaged' | 'count' | 'shortage'
type InvoiceRow = { id: string; supplier_name: string; invoice_number: string; invoice_date: string; due_date: string | null; amount: string; paid: string; remaining: string; status: string }

const TABS: { key: Tab; label: string; roles: string[] }[] = [
  { key: 'new', label: 'توريد جديد', roles: ['owner', 'manager', 'warehouse'] },
  { key: 'log', label: 'سجل التوريد', roles: ['owner', 'manager', 'warehouse', 'accountant'] },
  { key: 'damaged', label: 'التالف', roles: ['owner', 'manager', 'warehouse', 'accountant'] },
  { key: 'count', label: 'الجرد', roles: ['owner', 'manager', 'warehouse', 'accountant'] },
  { key: 'shortage', label: 'دفتر النواقص', roles: ['owner', 'manager', 'warehouse', 'accountant'] },
]

function SupplyLog() {
  const q = useQuery({
    queryKey: ['supply-log'],
    queryFn: async () => {
      const { data, error } = await supabase.from('supplier_invoice_balances').select('id,supplier_name,invoice_number,invoice_date,due_date,amount,paid,remaining,status').order('invoice_date', { ascending: false }).limit(200)
      if (error) throw error
      return data as InvoiceRow[]
    },
  })
  if (q.isLoading) return <State kind="loading" />
  if (q.isError) return <State kind="error" text="تعذّر تحميل السجل." />
  if (!q.data?.length) return <State kind="empty" title="لا توجد فواتير توريد بعد" />
  return (
    <Card className="overflow-x-auto">
      <div className="flex justify-end p-2">
        <button className="rounded-lg border border-line px-3 py-1 text-sm hover:bg-bg" onClick={() => downloadCsv('supply-log.csv', ['المورد', 'رقم الفاتورة', 'التاريخ', 'الاستحقاق', 'الإجمالي', 'المدفوع', 'المتبقي'],
          q.data.map((r) => [r.supplier_name, r.invoice_number, r.invoice_date, r.due_date ?? '', r.amount, r.paid, r.remaining]))}>تصدير CSV</button>
      </div>
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-muted"><tr className="border-b border-line">{['المورد', 'الفاتورة', 'التاريخ', 'الإجمالي', 'المدفوع', 'المتبقي', 'الحالة'].map((h) => <th key={h} scope="col" className="p-3 text-start font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {q.data.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0">
              <td className="p-3" dir="auto">{r.supplier_name}</td><td className="p-3" dir="ltr">{r.invoice_number}</td><td className="whitespace-nowrap p-3">{r.invoice_date}</td>
              <td className="p-3">{formatEGP(toMinor(r.amount))}</td><td className="p-3">{formatEGP(toMinor(r.paid))}</td>
              <td className="p-3 font-semibold">{formatEGP(toMinor(r.remaining))}</td>
              <td className="p-3">{r.status !== 'open' ? <Chip tone="warn">بانتظار مراجعة</Chip> : toMinor(r.remaining) === 0 ? <Chip tone="ok">مسدد</Chip> : <Chip tone="info">دين</Chip>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

export default function Supply() {
  const { roles } = useAuth()
  const tabs = TABS.filter((t) => t.roles.some((r) => (roles as string[]).includes(r)))
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'log')
  const [wizardKey, setWizardKey] = useState(0)

  return (
    <div>
      <PageHeader title="التوريد والجرد" subtitle="استلام البضاعة وفاتورة المورد في خطوة واحدة، والتالف والجرد ودفتر النواقص." />
      <div role="tablist" aria-label="أقسام التوريد" className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition active:scale-[0.97] ${tab === t.key ? 'border-accent btn-gel' : 'border-line bg-surface'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'new' && <SupplyWizard key={wizardKey} onDone={() => { setWizardKey((k) => k + 1); setTab('log') }} />}
      {tab === 'log' && <SupplyLog />}
      {tab === 'damaged' && <DamagedTab />}
      {tab === 'count' && <StockCount />}
      {tab === 'shortage' && <ShortageTab />}
    </div>
  )
}
