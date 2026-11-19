import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/** Notifications and tasks (migration 0041). RLS decides which alerts a user may see. */

export type NotificationRow = {
  id: string
  kind: 'low_stock' | 'shift_difference' | 'installment_overdue' | 'tax_due' | 'supplier_overdue' | 'task_due'
  severity: 'info' | 'warn' | 'critical'
  title: string
  body: string | null
  link: string | null
  created_at: string
  resolved_at: string | null
}

export const KIND_LABEL: Record<NotificationRow['kind'], string> = {
  low_stock: 'مخزون منخفض',
  shift_difference: 'فرق وردية',
  installment_overdue: 'أقساط متأخرة',
  tax_due: 'ضريبة موبايل',
  supplier_overdue: 'مورد متأخر',
  task_due: 'مهمة',
}

export const SEVERITY_TONE = { info: 'neutral', warn: 'warn', critical: 'danger' } as const

/** Runs the alert rules, then returns how many open alerts the user can see. Safe to repeat: the rules are idempotent. */
export async function refreshNotifications(): Promise<number> {
  const { data, error } = await supabase.rpc('refresh_notifications')
  if (error) throw error
  return data as number
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread'],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      await refreshNotifications()
      const { data, error } = await supabase.rpc('my_unread_notifications')
      if (error) throw error
      return data as number
    },
  })
}

/** Open alerts, newest first, with whether this user has read each one. */
export function useNotifications(limit = 100) {
  return useQuery({
    queryKey: ['notifications', 'list', limit],
    queryFn: async () => {
      const [list, reads] = await Promise.all([
        supabase.from('notifications')
          .select('id,kind,severity,title,body,link,created_at,resolved_at')
          .is('resolved_at', null).order('created_at', { ascending: false }).limit(limit),
        supabase.from('notification_reads').select('notification_id'),
      ])
      if (list.error) throw list.error
      if (reads.error) throw reads.error
      const read = new Set((reads.data ?? []).map((r) => r.notification_id as string))
      return (list.data as NotificationRow[]).map((n) => ({ ...n, read: read.has(n.id) }))
    },
  })
}

export type TaskRow = {
  id: string; title: string; details: string | null; priority: 'low' | 'normal' | 'high'
  remind_at: string | null; assigned_to: string | null; status: 'open' | 'done' | 'cancelled'
  created_by: string; created_at: string
}
export const PRIORITY_LABEL = { low: 'عادية', normal: 'متوسطة', high: 'عاجلة' } as const

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks')
        .select('id,title,details,priority,remind_at,assigned_to,status,created_by,created_at')
        .order('status').order('remind_at', { ascending: true, nullsFirst: false }).limit(200)
      if (error) throw error
      return data as TaskRow[]
    },
  })
}
