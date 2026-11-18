import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { State } from '../components/State'
import { Button, Card, Chip, ErrorText, PageHeader } from '../components/ui'
import { usePagePermissions, useTeam } from '../lib/people'
import { NAV, ROLE_LABEL, type AppRole } from '../lib/roles'
import { supabase } from '../lib/supabase'

/** Staff list and, for the owner, which pages each person may open. Roles decide what the database allows; a switched-off page hides the page and its data on top of that. */
export default function Team() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const owner = hasRole('owner')
  const team = useTeam()
  const perms = usePagePermissions()
  const [picked, setPicked] = useState<string | null>(null)

  const toggle = useMutation({
    mutationFn: async (v: { user: string; page: string; allowed: boolean | null }) => {
      const { error } = await supabase.rpc('set_page_permission', { p_user: v.user, p_page: v.page, p_allowed: v.allowed })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['page-permissions'] }),
  })

  const rows = team.data ?? []
  const member = rows.find((t) => t.id === picked) ?? null
  const denied = (user: string) => new Set((perms.data ?? []).filter((p) => p.user_id === user && !p.allowed).map((p) => p.page))
  const pagesFor = (roles: string[]) => NAV.filter((n) => n.to !== '/' && !n.soon && n.roles.some((r) => roles.includes(r)))
  const isOwnerRow = (roles: string[]) => roles.includes('owner')

  return (
    <div>
      <PageHeader title="إدارة الفريق" subtitle="مين شغال معانا وأدواره. المالك يقدر يقفل صفحات معينة على أي شخص (غير المالك)." />
      <ErrorText error={toggle.error} />
      {team.isLoading && <State kind="loading" />}
      {team.isError && <State kind="error" text="تعذّر تحميل الفريق." action={<Button onClick={() => void team.refetch()}>حاول تاني</Button>} />}
      {team.isSuccess && rows.length === 0 && <State kind="empty" title="لا يوجد مستخدمون" />}
      {rows.length > 0 && <Card className="mb-4 overflow-x-auto"><table className="w-full min-w-[620px] text-sm">
        <thead><tr className="border-b border-line text-muted">
          {['الاسم', 'الوظيفة', 'الأدوار', 'صفحات مقفولة', ''].map((h, i) => <th key={i} scope="col" className="p-3 text-start font-medium">{h}</th>)}
        </tr></thead>
        <tbody>{rows.map((t) => {
          const d = denied(t.id).size
          return <tr key={t.id} className="border-b border-line last:border-0">
            <td className="p-3"><p dir="auto" className="font-medium">{t.full_name || t.email || 'بدون اسم'}{!t.is_active && <span className="ms-2"><Chip>موقوف</Chip></span>}</p>{t.email && <bdi className="text-xs text-muted">{t.email}</bdi>}</td>
            <td className="p-3" dir="auto">{t.job_title ?? '—'}</td>
            <td className="p-3"><div className="flex flex-wrap gap-1">{t.roles.length ? t.roles.map((r) => <Chip key={r} tone={r === 'owner' ? 'info' : 'neutral'}>{ROLE_LABEL[r as AppRole] ?? r}</Chip>) : <Chip tone="warn">بدون دور</Chip>}</div></td>
            <td className="p-3">{d ? <Chip tone="warn">{d}</Chip> : '—'}</td>
            <td className="p-3">{owner && !isOwnerRow(t.roles) && <Button small onClick={() => setPicked(picked === t.id ? null : t.id)}>الصفحات</Button>}</td>
          </tr>
        })}</tbody>
      </table></Card>}

      {owner && member && <Card className="p-4">
        <h2 className="mb-1 font-semibold">صفحات {member.full_name}</h2>
        <p className="mb-3 text-xs text-muted">شيل العلامة لقفل الصفحة عليه. بيتطبق فورًا على الصفحة وعلى بياناتها (سجل العمليات، الأمان، حسابات الموظفين، الحضور، ضريبة الموبايل). باقي الصفحات محكومة بدوره.</p>
        {perms.isLoading && <State kind="loading" />}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {pagesFor(member.roles).map((n) => {
            const off = denied(member.id).has(n.to)
            return <label key={n.to} className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={!off} disabled={toggle.isPending}
                onChange={(e) => toggle.mutate({ user: member.id, page: n.to, allowed: e.target.checked ? null : false })} />
              <span>{n.label}</span>
              {off && <span className="ms-auto"><Chip tone="danger">مقفولة</Chip></span>}
            </label>
          })}
        </div>
      </Card>}
      {!owner && <p className="text-xs text-muted">تعديل صفحات الأشخاص للمالك فقط.</p>}
    </div>
  )
}
