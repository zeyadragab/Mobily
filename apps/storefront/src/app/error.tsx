"use client";

import { useEffect } from "react";

// Shown for any unexpected error. The customer sees a generic message and a reference ID only;
// details stay in the server log (the digest links the two).
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(`[storefront-error ${error.digest ?? "client"}]`);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <h1 className="text-2xl font-bold">حدث خطأ غير متوقع</h1>
      <p className="text-sm text-muted">
        حاول مرة أخرى. لو تكرر الخطأ تواصل معنا واذكر الرقم المرجعي:{" "}
        <span className="font-mono">{error.digest ?? "—"}</span>
      </p>
      <button onClick={reset} className="rounded-xl bg-accent px-6 py-3 font-semibold text-accent-fg">
        إعادة المحاولة
      </button>
    </div>
  );
}
