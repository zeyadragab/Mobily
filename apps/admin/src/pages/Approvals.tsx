import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { formatEGP } from '../lib/money'
import { formatCairo } from '../lib/time'
import { State } from '../components/State'

type Row = {
  id: string
  action_type: string
  subject_entity: string
  amount: string | null
  reason: string | null
  status: string
  requested_by: string
  created_at: string
}

const STATUS_AR: Record<string, string> = {
  submitted: 'بانتظار القرار',
  approved: 'تمت الموافقة',
  rejected: 'مرفوض',
  changes_requested: 'مطلوب تعديل',
  executed: 'تم التنفيذ',
  expired: 'منتهي',
  superseded: 'استُبدل',
  draft: 'مسودة',
}

const ACTION_AR: Record<string, string> = {
  'purchase_order.send': 'إرسال طلبية للمورد',
  'sale.discount': 'خصم كبير على فاتورة بيع',
  'expense.create': 'مصروف كبير',
  'sale.return': 'مرتجع بيع',
  'supplier_invoice.review': 'فاتورة مورد تختلف عن المستلم',
  'supplier.payment': 'دفعة كبيرة لمورد',
}

export default function Approvals() {
  const qc = useQueryClient()
  const { session, hasRole } = useAuth()
  const [filter, setFilter] = useState<'submitted' | 'all'>('submitted')
  const [comment, setComment] = useState<Record<string, string>>({})

  const q = useQuery({
    queryKey: ['approvals', filter],
    queryFn: async () => {
      let b = supabase
        .from('approval_requests')
        .select('id,action_type,subject_entity,amount,reason,status,requested_by,created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (filter === 'submitted') b = b.eq('status', 'submitted')
      const { data, error } = await b
      if (error) throw error
      return data as Row[]
    },
  })

  const decide = useMutation({
    mutationFn: async (v: { id: string; decision: string }) => {
      const { error } = await supabase.rpc('decide_approval', {
        p_request: v.id,
        p_decision: v.decision,
        p_comment: comment[v.id] || null,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
  })

  const btn = 'rounded-lg border border-line px-3 py-2 text-sm hover:bg-bg disabled:opacity-50'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">الموافقات</h1>
        <div className="flex gap-1" role="group" aria-label="تصفية">
          {(['submitted', 'all'] as const).map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-2 text-sm ${
                filter === f ? 'bg-accent text-accent-fg' : 'border border-line'
              }`}
            >
              {f === 'submitted' ? 'المعلّقة' : 'الكل'}
            </button>
          ))}
        </div>
      </div>

      {decide.isError && (
        <p role="alert" className="text-sm text-danger">
          {(decide.error as Error).message}
        </p>
      )}

      {q.isLoading && <State kind="loading" />}
      {q.isError && <State kind="error" text="تعذّر تحميل الطلبات." />}
      {q.data?.length === 0 && <State kind="empty" title="لا توجد طلبات موافقة" />}

      <ul className="space-y-3">
        {q.data?.map((r) => {
          const own = r.requested_by === session?.user.id
          return (
            <li key={r.id} className="space-y-3 rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{ACTION_AR[r.action_type] ?? r.action_type}</p>
                <span className="rounded-full border border-line px-2 py-1 text-xs">
                  {STATUS_AR[r.status] ?? r.status}
                </span>
              </div>
              <p className="text-sm text-muted">
                {r.amount != null && <>القيمة: {formatEGP(Math.round(Number(r.amount) * 100))} · </>}
                {formatCairo(r.created_at)}
              </p>
              {r.reason && <p className="text-sm">{r.reason}</p>}
              {r.status === 'submitted' && hasRole('owner') && (
                <div className="space-y-2">
                  {own && (
                    <p className="text-xs text-muted">
                      لا يمكنك اعتماد طلبك أنت (فصل الأدوار).
                    </p>
                  )}
                  <input
                    className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
                    placeholder="تعليق (اختياري)"
                    aria-label="تعليق"
                    value={comment[r.id] ?? ''}
                    onChange={(e) => setComment({ ...comment, [r.id]: e.target.value })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={`${btn} !bg-accent !text-accent-fg`}
                      disabled={decide.isPending || own}
                      onClick={() => decide.mutate({ id: r.id, decision: 'approved' })}
                    >
                      موافقة
                    </button>
                    <button
                      className={btn}
                      disabled={decide.isPending || own}
                      onClick={() => decide.mutate({ id: r.id, decision: 'rejected' })}
                    >
                      رفض
                    </button>
                    <button
                      className={btn}
                      disabled={decide.isPending || own}
                      onClick={() => decide.mutate({ id: r.id, decision: 'changes_requested' })}
                    >
                      طلب تعديل
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
