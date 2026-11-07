"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { egp } from "@/lib/catalog";
import { supabase } from "@/lib/supabase";
import { STATUS_AR } from "@/lib/orders";

type Tracked = {
  order_number: string;
  status: keyof typeof STATUS_AR;
  fulfilment: "pickup" | "delivery";
  total: string;
  created_at: string;
  reserved_until: string;
  cancel_reason: string | null;
  lines: { name: string; qty: number; unit_price: string }[];
};

const STEPS = ["reserved", "confirmed", "ready", "delivered"] as const;

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export default function OrderStatus({ number }: { number: string }) {
  const token = useSearchParams().get("t") ?? "";
  const [order, setOrder] = useState<Tracked | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      const { data, error } = await supabase.rpc("track_order", { p_number: number, p_token: token });
      if (!alive) return;
      if (error) return setFailed(true);
      setFailed(false);
      setOrder((data as Tracked | null) ?? null);
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [number, token]);

  if (order === undefined && !failed) return <p className="py-16 text-center text-muted">جارٍ التحميل…</p>;
  if (failed && order === undefined)
    return (
      <p role="alert" className="py-16 text-center text-danger">
        تعذّر تحميل حالة الطلب. حاول مرة أخرى بعد قليل.
      </p>
    );
  if (order === null || order === undefined)
    return (
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <h1 className="text-2xl font-bold">لم نجد الطلب</h1>
        <p className="text-muted">تأكد من الرابط أو من رقم الطلب والرمز.</p>
        <Link href="/track" className="inline-block rounded-xl border border-line px-5 py-2">
          جرّب من صفحة التتبع
        </Link>
      </div>
    );

  const dead = order.status === "cancelled" || order.status === "expired";
  const idx = STEPS.indexOf(order.status as (typeof STEPS)[number]);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-sm text-muted">رقم الطلب</p>
        <h1 className="text-2xl font-bold" dir="ltr">
          {order.order_number}
        </h1>
        <p className="text-sm text-muted">{fmt(order.created_at)}</p>
      </div>

      <div className={`rounded-2xl border p-4 ${dead ? "border-danger/40 bg-danger/10" : "border-line bg-surface"}`} role="status">
        <p className="font-semibold">{STATUS_AR[order.status]}</p>
        {order.status === "reserved" && (
          <p className="mt-1 text-sm text-muted">
            القطعة محجوزة لك حتى {fmt(order.reserved_until)}. سيتواصل معك المحل لتأكيد الطلب.
          </p>
        )}
        {order.status === "expired" && <p className="mt-1 text-sm">انتهت مدة الحجز. يمكنك إنشاء حجز جديد لو القطعة ما زالت متوفرة.</p>}
        {order.status === "cancelled" && order.cancel_reason && <p className="mt-1 text-sm">السبب: {order.cancel_reason}</p>}
      </div>

      {!dead && (
        <ol className="grid grid-cols-4 gap-2 text-center text-xs" aria-label="مراحل الطلب">
          {STEPS.map((s, i) => (
            <li key={s} className={i <= idx ? "font-semibold" : "text-muted"}>
              <span className={`mx-auto mb-1 block h-2 rounded-full ${i <= idx ? "bg-accent" : "bg-line"}`} />
              {s === "reserved" ? "محجوز" : s === "confirmed" ? "مؤكد" : s === "ready" ? "جاهز" : "تم التسليم"}
            </li>
          ))}
        </ol>
      )}

      <div className="space-y-2 rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm text-muted">{order.fulfilment === "pickup" ? "الاستلام من المحل" : "التوصيل"}</p>
        <ul className="space-y-2 text-sm">
          {order.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span dir="auto">
                {l.name} <span className="text-muted">× {l.qty}</span>
              </span>
              <span className="whitespace-nowrap">{egp(Number(l.unit_price) * l.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-line pt-2 font-bold">
          <span>الإجمالي</span>
          <span>{egp(order.total)}</span>
        </div>
      </div>
      <p className="text-xs text-muted">احتفظ برابط هذه الصفحة لمتابعة طلبك. لا يتم أي دفع أونلاين.</p>
    </div>
  );
}
