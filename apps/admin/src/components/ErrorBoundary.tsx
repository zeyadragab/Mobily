import { Component, type ReactNode } from 'react'

/** Last line of defence: show a generic message plus a reference ID; details stay in the console/log only. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { ref: string | null }> {
  state = { ref: null as string | null }

  static getDerivedStateFromError() {
    return { ref: Math.random().toString(16).slice(2, 8).toUpperCase() }
  }

  componentDidCatch(error: Error) {
    // Replace with a monitoring service call (e.g. Sentry) before launch. Never log passwords or personal data.
    console.error(`[ui-error ${this.state.ref}]`, error.message)
  }

  render() {
    if (!this.state.ref) return this.props.children
    return (
      <div role="alert" className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-xl font-bold">حدث خطأ غير متوقع</p>
        <p className="text-sm text-muted">حاول تحديث الصفحة. لو تكرر الخطأ، أبلغ المسؤول واذكر الرقم المرجعي: <span className="font-mono">{this.state.ref}</span></p>
        <button className="rounded-lg bg-accent px-4 py-2 text-sm text-accent-fg" onClick={() => location.reload()}>تحديث الصفحة</button>
      </div>
    )
  }
}
