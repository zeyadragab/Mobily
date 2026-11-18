import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

/** Shared by the employee accounts, attendance, team and mobile-tax screens (migration 0034). */

export type EmployeeRow = {
  id: string; profile_id: string | null; name: string; phone: string | null; job_title: string | null
  monthly_salary: number | string; pay_day: number; start_date: string; is_active: boolean
  balance: number | string; last_period: string | null; last_entry_at: string | null
}
export function useEmployees() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_balances')
        .select('id,profile_id,name,phone,job_title,monthly_salary,pay_day,start_date,is_active,balance,last_period,last_entry_at').order('name')
      if (error) throw error
      return data as EmployeeRow[]
    },
  })
}

export const LEDGER_KIND = {
  accrual: 'استحقاق راتب', pay: 'صرف راتب', advance: 'سلفة', bonus: 'مكافأة', deduction: 'خصم', correction: 'تصحيح',
} as const
export type LedgerRow = {
  id: number; amount: number | string; kind: keyof typeof LEDGER_KIND; period: string | null; note: string | null
  drawer_code: string | null; account_id: string | null; reverses: number | null; created_at: string
}
export function useEmployeeLedger(employee: string | null) {
  return useQuery({
    queryKey: ['employee-ledger', employee],
    enabled: !!employee,
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_ledger')
        .select('id,amount,kind,period,note,drawer_code,account_id,reverses,created_at')
        .eq('employee_id', employee!).order('id', { ascending: false }).limit(200)
      if (error) throw error
      return data as LedgerRow[]
    },
  })
}

export type AttendanceEmployee = { id: string; name: string; job_title: string | null; is_active: boolean; is_me: boolean }
export function useAttendanceEmployees() {
  return useQuery({
    queryKey: ['attendance-employees'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('attendance_employees')
      if (error) throw error
      return data as AttendanceEmployee[]
    },
  })
}

export type AttendanceRow = {
  id: number; employee_id: string; work_date: string; check_in: string | null; check_out: string | null
  shift_start: string; shift_end: string; late_minutes: number; early_leave_minutes: number; overtime_minutes: number; note: string | null
}
export function useAttendance(month: string) {
  return useQuery({
    queryKey: ['attendance', month],
    queryFn: async () => {
      const first = `${month}-01`
      const [y, m] = month.split('-').map(Number)
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
      const { data, error } = await supabase.from('attendance_records')
        .select('id,employee_id,work_date,check_in,check_out,shift_start,shift_end,late_minutes,early_leave_minutes,overtime_minutes,note')
        .gte('work_date', first).lt('work_date', next).order('work_date', { ascending: false }).limit(3000)
      if (error) throw error
      return data as AttendanceRow[]
    },
  })
}

export type TeamRow = { id: string; full_name: string; email: string | null; job_title: string | null; is_active: boolean; roles: string[] }
export function useTeam() {
  return useQuery({
    queryKey: ['team'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_team')
      if (error) throw error
      return data as TeamRow[]
    },
  })
}

export function usePagePermissions() {
  return useQuery({
    queryKey: ['page-permissions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_page_permissions').select('user_id,page,allowed')
      if (error) throw error
      return data as { user_id: string; page: string; allowed: boolean }[]
    },
  })
}

export type TaxRow = {
  id: string; customer_name: string; phone: string | null; device: string | null; imei: string | null
  amount: number | string; due_date: string; status: 'open' | 'paid' | 'cancelled'; note: string | null; created_at: string
}
export function useTaxReminders() {
  return useQuery({
    queryKey: ['tax-reminders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tax_reminders')
        .select('id,customer_name,phone,device,imei,amount,due_date,status,note,created_at').order('due_date').limit(1000)
      if (error) throw error
      return data as TaxRow[]
    },
  })
}
