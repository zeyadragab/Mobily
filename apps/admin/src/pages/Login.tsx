import { useState, type FormEvent } from 'react'
import { isConfigured, supabase } from '../lib/supabase'
import { Icon } from '../components/ui'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('البريد أو كلمة المرور غير صحيحة.')
    setBusy(false)
  }

  const field = 'w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-base shadow-soft outline-none'

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm animate-rise space-y-4 rounded-[22px] border border-line/60 bg-surface/75 p-7 shadow-window backdrop-blur-2xl backdrop-saturate-150"
      >
        <div className="flex flex-col items-center gap-3 pb-1 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-gradient-to-b from-accent/80 to-accent text-accent-fg shadow-float">
            <Icon name="shield" className="h-8 w-8" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">تسجيل الدخول</h1>
            <p className="mt-1 text-sm text-muted">ادخل بحسابك لمتابعة شغل المحل.</p>
          </div>
        </div>
        {!isConfigured && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            لم يتم ضبط الاتصال بقاعدة البيانات (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
          </p>
        )}
        <label className="block space-y-1">
          <span className="text-sm font-medium text-muted">البريد الإلكتروني</span>
          <input className={field} type="email" dir="ltr" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-muted">كلمة المرور</span>
          <input className={field} type="password" dir="ltr" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="w-full rounded-xl bg-accent py-3 font-semibold text-accent-fg shadow-soft transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? 'جارٍ الدخول…' : 'دخول'}
        </button>
      </form>
    </div>
  )
}
