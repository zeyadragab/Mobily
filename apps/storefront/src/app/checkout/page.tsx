"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { cart, useCart } from "@/lib/cart";
import { egp } from "@/lib/catalog";
import { supabase } from "@/lib/supabase";
import { saveOrder } from "@/lib/orders";

const ERRORS: [RegExp, string][] = [
  [/not enough stock|item unavailable/i, "إحدى القطع لم تعد متوفرة بالكمية المطلوبة. راجع السلة وحاول مرة أخرى."],
  [/too many open orders/i, "لديك 3 طلبات مفتوحة بالفعل على هذا الرقم. انتظر تأكيدها أو تواصل مع المحل."],
  [/invalid phone/i, "رقم الهاتف غير صحيح."],
  [/invalid name/i, "الاسم غير صحيح."],
  [/address required/i, "العنوان مطلوب للتوصيل."],
];

const field = "w-full rounded-lg border border-line bg-bg px-3 py-3 text-base outline-none focus:border-accent";

export default function Checkout() {
  const { lines, total } = useCart();
  const router = useRouter();
  const [f, setF] = useState({ name: "", phone: "", fulfilment: "pickup", address: "", notes: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <h1 className="text-2xl font-bold">السلة فارغة</h1>
        <Link href="/products" className="inline-block rounded-xl bg-accent px-6 py-3 font-semibold text-accent-fg">
          تصفح المنتجات
        </Link>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (f.website) return; // honeypot: real users never fill this hidden field
    setError(null);
    const phone = f.phone.replace(/\D/g, "");
    if (f.name.trim().length < 2) return setError("اكتب اسمك.");
    if (phone.length < 10 || phone.length > 15) return setError("رقم الهاتف غير صحيح.");
    if (f.fulfilment === "delivery" && f.address.trim().length < 6) return setError("اكتب العنوان بالتفصيل للتوصيل.");

    setBusy(true);
    const { data, error: err } = await supabase.rpc("place_online_order", {
      p_name: f.name.trim(),
      p_phone: phone,
      p_address: f.fulfilment === "delivery" ? f.address.trim() : null,
      p_fulfilment: f.fulfilment,
      p_notes: f.notes.trim() || null,
      p_items: lines.map((l) => ({ variant_id: l.variant_id, qty: l.qty })),
    });
    if (err || !data) {
      setBusy(false);
      return setError(ERRORS.find(([re]) => re.test(err?.message ?? ""))?.[1] ?? "تعذّر إتمام الحجز. حاول مرة أخرى.");
    }
    const r = data as { order_number: string; access_token: string };
    saveOrder({ number: r.order_number, token: r.access_token, at: new Date().toISOString() });
    cart.clear();
    router.push(`/order/${r.order_number}?t=${r.access_token}`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
        <h1 className="text-2xl font-bold">بيانات الحجز</h1>

        <label className="block space-y-1">
          <span className="text-sm text-muted">الاسم *</span>
          <input className={field} required autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-muted">رقم الموبايل (واتساب) *</span>
          <input className={field} required type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm text-muted">طريقة الاستلام</legend>
          <div className="flex flex-wrap gap-2">
            {([["pickup", "استلام من المحل"], ["delivery", "توصيل"]] as const).map(([k, l]) => (
              <label key={k} className={`cursor-pointer rounded-xl border px-4 py-3 text-sm ${f.fulfilment === k ? "border-accent bg-accent text-accent-fg" : "border-line hover:border-accent"}`}>
                <input type="radio" className="sr-only" name="fulfilment" checked={f.fulfilment === k} onChange={() => setF({ ...f, fulfilment: k })} />
                {l}
              </label>
            ))}
          </div>
        </fieldset>

        {f.fulfilment === "delivery" && (
          <label className="block space-y-1">
            <span className="text-sm text-muted">العنوان بالتفصيل *</span>
            <textarea className={field} rows={3} required autoComplete="street-address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-sm text-muted">ملاحظات (اختياري)</span>
          <textarea className={field} rows={2} maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </label>

        {/* honeypot */}
        <div aria-hidden="true" className="absolute -start-[9999px]">
          <label>
            الموقع
            <input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
          </label>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <button disabled={busy} className="w-full rounded-xl bg-accent py-3 font-semibold text-accent-fg disabled:opacity-50">
          {busy ? "جارٍ الحجز…" : "تأكيد الحجز"}
        </button>
        <p className="text-xs text-muted">
          الحجز لمدة 24 ساعة. سيتواصل معك المحل لتأكيد الطلب. لا يتم أي دفع الآن.
        </p>
      </form>

      <aside className="h-fit space-y-3 rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-bold">طلبك</h2>
        <ul className="space-y-2 text-sm">
          {lines.map((l) => (
            <li key={l.variant_id} className="flex justify-between gap-2">
              <span dir="auto">
                {l.name} <span className="text-muted">× {l.qty}</span>
              </span>
              <span className="whitespace-nowrap">{egp(l.price * l.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-line pt-3">
          <span className="text-muted">الإجمالي</span>
          <span className="text-lg font-bold">{egp(total)}</span>
        </div>
      </aside>
    </div>
  );
}
