import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { AppRole } from '../lib/roles'

type AuthState = {
  loading: boolean
  session: Session | null
  roles: AppRole[]
  fullName: string
  /** false when the owner switched this page off for the signed-in user (UI only; the database enforces it too) */
  canPage: (path: string) => boolean
  hasRole: (...r: AppRole[]) => boolean
  signOut: () => Promise<void>
  /** true while the user arrived from a password-recovery email and must set a new password */
  recovery: boolean
  endRecovery: () => void
}

// The recovery link lands with #...&type=recovery; read it before supabase-js clears the hash.
const arrivedViaRecovery = typeof window !== 'undefined' && /[#&]type=recovery(&|$)/.test(window.location.hash)

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [roles, setRoles] = useState<AppRole[]>([])
  const [fullName, setFullName] = useState('')
  const [denied, setDenied] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(arrivedViaRecovery)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
      if (!s) {
        setRoles([])
        setDenied(new Set())
        setFullName('')
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', uid),
      supabase.from('profiles').select('full_name').eq('id', uid).single(),
      supabase.rpc('my_page_permissions'),
    ]).then(([r, p, pp]) => {
      if (cancelled) return
      setDenied(new Set(((pp.data ?? []) as { page: string; allowed: boolean }[]).filter((x) => !x.allowed).map((x) => x.page)))
      setRoles((r.data ?? []).map((x) => x.role as AppRole))
      setFullName(p.data?.full_name ?? '')
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [uid])

  // Force logout: the owner can end a user's sessions. Check on focus and every minute.
  // Only an explicit `false` signs out; a network or missing-function error never does.
  useEffect(() => {
    if (!uid) return
    let stopped = false
    const check = async () => {
      const { data, error } = await supabase.rpc('is_current_session_valid')
      if (!stopped && !error && data === false) await supabase.auth.signOut()
    }
    const t = window.setInterval(check, 60_000)
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    void check()
    return () => {
      stopped = true
      window.clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [uid])

  const value: AuthState = {
    loading,
    session,
    roles,
    fullName: fullName || session?.user.email || '',
    canPage: (path) => !denied.has(path),
    hasRole: (...r) => r.some((x) => roles.includes(x)),
    signOut: async () => {
      await supabase.auth.signOut()
    },
    recovery,
    endRecovery: () => setRecovery(false),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}
