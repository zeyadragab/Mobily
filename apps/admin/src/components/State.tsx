import type { ReactNode } from 'react'

type Props = {
  kind: 'loading' | 'empty' | 'error'
  title?: string
  text?: string
  action?: ReactNode
}

const DEFAULT_TITLE = {
  loading: 'جارٍ التحميل…',
  empty: 'لا توجد بيانات',
  error: 'حدث خطأ',
}

export function State({ kind, title, text, action }: Props) {
  if (kind === 'loading') {
    return (
      <div role="status" aria-label={title ?? DEFAULT_TITLE.loading} className="space-y-3 py-4">
        <div className="skeleton h-10 w-1/3" />
        <div className="skeleton h-24 w-full" />
        <div className="skeleton h-24 w-full" />
        <span className="sr-only">{title ?? DEFAULT_TITLE.loading}</span>
      </div>
    )
  }
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className="mx-auto flex min-h-[36vh] max-w-md animate-rise flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <span aria-hidden="true" className={`mb-1 flex h-12 w-12 items-center justify-center rounded-2xl text-xl ${kind === 'error' ? 'bg-danger/10 text-danger' : 'bg-muted/10 text-muted'}`}>
        {kind === 'error' ? '!' : '∅'}
      </span>
      <p className={`text-lg font-semibold ${kind === 'error' ? 'text-danger' : ''}`}>
        {title ?? DEFAULT_TITLE[kind]}
      </p>
      {text && <p className="text-sm text-muted">{text}</p>}
      {action}
    </div>
  )
}
