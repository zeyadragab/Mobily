"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { loadOrders, type SavedOrder } from "@/lib/orders";

const field = "field";

export default function TrackPage() {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedOrder[]>([]);
  const [num, setNum] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    // read after mount: localStorage does not exist on the server
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(loadOrders());
  }, []);

  function go(e: FormEvent) {
    e.preventDefault();
    router.push(`/order/${encodeURIComponent(num.trim().toUpperCase())}?t=${encodeURIComponent(code.trim())}`);
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-3xl font-extrabold">تتبع طلبي</h1>

      {saved.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">طلباتك على هذا الجهاز</h2>
          <ul className="space-y-2">
            {saved.map((o) => (
              <li key={o.number}>
                <Link href={`/order/${o.number}?t=${o.token}`} className="card flex justify-between px-5 py-4 transition hover:-translate-y-0.5 hover:border-accent">
                  <span dir="ltr" className="font-semibold">{o.number}</span>
                  <span className="text-sm text-muted">عرض الحالة</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={go} className="card space-y-4 p-6">
        <h2 className="font-semibold">أو أدخل بيانات الطلب</h2>
        <label className="block space-y-1">
          <span className="text-sm text-muted">رقم الطلب</span>
          <input className={field} dir="ltr" required placeholder="WEB-1001" value={num} onChange={(e) => setNum(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-muted">رمز التتبع (من رابط الطلب)</span>
          <input className={field} dir="ltr" required value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <button className="btn-primary btn-shine w-full">عرض الحالة</button>
      </form>
    </div>
  );
}
