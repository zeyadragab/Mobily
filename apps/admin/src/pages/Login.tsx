import { useState, type FormEvent } from 'react'
import { isConfigured, supabase } from '../lib/supabase'

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

  const field =
    'w-full rounded-lg border border-line bg-bg px-3 py-3 text-base outline-none focus:border-accent'

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6"
      >
        <h1 className="text-2xl font-bold">تسجيل الدخول</h1>
        {!isConfigured && (
          <p role="alert" className="rounded-lg border border-line p-3 text-sm text-danger">
            لم يتم ضبط الاتصال بقاعدة البيانات (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
          </p>
        )}
        <label className="block space-y-1">
          <span className="text-sm text-muted">البريد الإلكتروني</span>
          <input
            className={field}
            type="email"
            dir="ltr"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-muted">كلمة المرور</span>
          <input
            className={field}
            type="password"
            dir="ltr"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-accent py-3 font-semibold text-accent-fg disabled:opacity-50"
        >
          {busy ? 'جارٍ الدخول…' : 'دخول'}
        </button>
      </form>
    </div>
  )
}
