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
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <p className={`text-lg font-semibold ${kind === 'error' ? 'text-danger' : ''}`}>
        {title ?? DEFAULT_TITLE[kind]}
      </p>
      {text && <p className="text-sm text-muted">{text}</p>}
      {action}
    </div>
  )
}
