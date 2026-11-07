import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { AppRole } from '../lib/roles'

type AuthState = {
  loading: boolean
  session: Session | null
  roles: AppRole[]
  fullName: string
  hasRole: (...r: AppRole[]) => boolean
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [roles, setRoles] = useState<AppRole[]>([])
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) {
        setRoles([])
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
    ]).then(([r, p]) => {
      if (cancelled) return
      setRoles((r.data ?? []).map((x) => x.role as AppRole))
      setFullName(p.data?.full_name ?? '')
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [uid])

  const value: AuthState = {
    loading,
    session,
    roles,
    fullName: fullName || session?.user.email || '',
    hasRole: (...r) => r.some((x) => roles.includes(x)),
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}
