import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Icon } from '../components/ui'

const MIN_LEN = 10

export default function ResetPassword() {
  const { endRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_LEN) return setError(`كلمة المرور لازم تكون ${MIN_LEN} حروف على الأقل.`)
    if (password !== confirm) return setError('كلمتا المرور غير متطابقتين.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError('تعذّر تغيير كلمة المرور. الرابط قد يكون انتهى، اطلب رابطاً جديداً.')
    // Drop the token from the address bar and continue into the app.
    window.history.replaceState(null, '', window.location.pathname)
    endRecovery()
  }

  const field = 'w-full rounded-[14px] border border-line bg-surface px-3.5 py-3 text-base outline-none'

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="glass glass--thick w-full max-w-sm animate-rise space-y-4 rounded-[32px] p-7">
        <div className="flex flex-col items-center gap-3 pb-1 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-gradient-to-b from-accent/80 to-accent text-accent-fg shadow-float">
            <Icon name="shield" className="h-8 w-8" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">كلمة مرور جديدة</h1>
            <p className="mt-1 text-sm text-muted">اكتب كلمة المرور الجديدة لحسابك.</p>
          </div>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-muted">كلمة المرور الجديدة</span>
          <input className={field} type="password" dir="ltr" autoComplete="new-password" required minLength={MIN_LEN}
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-muted">تأكيد كلمة المرور</span>
          <input className={field} type="password" dir="ltr" autoComplete="new-password" required minLength={MIN_LEN}
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}
        <button disabled={busy} className="btn-gel w-full rounded-full py-3 font-semibold active:scale-[0.98] disabled:opacity-50">
          {busy ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}
        </button>
      </form>
    </div>
  )
}
