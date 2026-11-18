import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { Button, ErrorText, Field, inputCls } from './ui'

const KEY = 'idle-locked'
const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const

function stored(): boolean { try { return sessionStorage.getItem(KEY) === '1' } catch { return false } }
function store(v: boolean) { try { if (v) sessionStorage.setItem(KEY, '1'); else sessionStorage.removeItem(KEY) } catch { /* private mode: lock stays in memory only */ } }

/** Locks the screen after a quiet period (unlock with the account password) and signs out after a longer one. 0 turns a limit off. */
export default function IdleLock() {
  const { session, signOut } = useAuth()
  const limits = useQuery({
    queryKey: ['idle-limits'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('key,value').in('key', ['idle_lock_minutes', 'idle_logout_minutes'])
      if (error) throw error
      const get = (k: string, d: number) => { const v = data?.find((r) => r.key === k)?.value; return v == null ? d : Number(v) }
      return { lock: get('idle_lock_minutes', 10), out: get('idle_logout_minutes', 60) }
    },
    staleTime: 5 * 60_000,
  })
  const [locked, setLocked] = useState(stored)
  const last = useRef(0)
  const lockedAt = useRef<number | null>(null)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    last.current = Date.now()
    if (stored()) lockedAt.current = last.current
  }, [])

  useEffect(() => {
    const touch = () => { if (!locked) last.current = Date.now() }
    EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    return () => EVENTS.forEach((e) => window.removeEventListener(e, touch))
  }, [locked])

  useEffect(() => {
    if (!limits.data) return
    const { lock, out } = limits.data
    const t = window.setInterval(() => {
      const now = Date.now()
      if (out > 0 && now - (lockedAt.current ?? last.current) >= out * 60_000) { store(false); void signOut(); return }
      if (lock > 0 && !locked && now - last.current >= lock * 60_000) { lockedAt.current = last.current; store(true); setLocked(true) }
    }, 10_000)
    return () => window.clearInterval(t)
  }, [limits.data, locked, signOut])

  if (!locked) return null
  const email = session?.user.email ?? ''

  async function unlock(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    setBusy(false); setPw('')
    if (error) { setErr(new Error('كلمة المرور غير صحيحة.')); return }
    store(false); lockedAt.current = null; last.current = Date.now(); setLocked(false)
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="الشاشة مقفولة" className="fixed inset-0 z-[100] flex items-center justify-center bg-bg p-4">
      <form onSubmit={unlock} className="w-full max-w-sm space-y-4 rounded-2xl border border-line/70 bg-surface p-6 shadow-window">
        <h1 className="text-xl font-bold">الشاشة مقفولة</h1>
        <p className="text-sm text-muted">اتقفلت لعدم الاستخدام. اكتب كلمة مرور حسابك للمتابعة، أو اخرج.</p>
        <p className="text-sm" dir="ltr">{email}</p>
        <ErrorText error={err} />
        <Field label="كلمة المرور"><input className={inputCls} type="password" autoComplete="current-password" autoFocus dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy || !pw}>{busy ? 'جارٍ التحقق…' : 'فتح'}</Button>
          <Button type="button" onClick={() => { store(false); void signOut() }}>خروج</Button>
        </div>
      </form>
    </div>
  )
}
