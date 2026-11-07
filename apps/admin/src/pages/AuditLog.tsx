import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatCairo } from '../lib/time'
import { State } from '../components/State'

type Row = {
  id: number
  occurred_at: string
  actor_id: string | null
  entity: string
  entity_id: string | null
  action: string
  reason: string | null
}

export default function AuditLog() {
  const [search, setSearch] = useState('')
  const [dir, setDir] = useState<'desc' | 'asc'>('desc')

  const q = useQuery({
    queryKey: ['audit'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_log')
        .select('id,occurred_at,actor_id,entity,entity_id,action,reason')
        .order('occurred_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data as Row[]
    },
  })

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    const f = (q.data ?? []).filter(
      (r) =>
        !s ||
        [r.entity, r.entity_id, r.action, r.actor_id, r.reason]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(s)),
    )
    return dir === 'desc' ? f : [...f].reverse()
  }, [q.data, search, dir])

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['id', 'occurred_at', 'actor_id', 'entity', 'entity_id', 'action', 'reason']
    const lines = rows.map((r) =>
      [r.id, r.occurred_at, r.actor_id, r.entity, r.entity_id, r.action, r.reason].map(esc).join(','),
    )
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'audit-log.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">سجل العمليات</h1>
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          placeholder="بحث بالكيان أو المرجع أو الإجراء"
          aria-label="بحث"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="rounded-lg border border-line px-3 py-2 text-sm"
          onClick={() => setDir(dir === 'desc' ? 'asc' : 'desc')}
        >
          الوقت {dir === 'desc' ? '↓' : '↑'}
        </button>
        <button
          className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50"
          disabled={rows.length === 0}
          onClick={exportCsv}
        >
          تصدير CSV
        </button>
      </div>

      {q.isLoading && <State kind="loading" />}
      {q.isError && <State kind="error" text="تعذّر تحميل السجل." />}
      {q.data && rows.length === 0 && <State kind="empty" title="لا توجد أحداث مطابقة" />}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="text-muted">
              <tr className="border-b border-line text-start">
                {['الوقت', 'الكيان', 'المرجع', 'الإجراء', 'المستخدم'].map((h) => (
                  <th key={h} scope="col" className="p-3 text-start font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap p-3">{formatCairo(r.occurred_at)}</td>
                  <td className="p-3">{r.entity}</td>
                  <td className="p-3 font-mono text-xs" dir="ltr">
                    {r.entity_id?.slice(0, 8)}
                  </td>
                  <td className="p-3">{r.action}</td>
                  <td className="p-3 font-mono text-xs" dir="ltr">
                    {r.actor_id?.slice(0, 8) ?? 'system'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
