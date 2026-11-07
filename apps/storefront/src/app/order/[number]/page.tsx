import type { Metadata } from "next";
import { Suspense } from "react";
import OrderStatus from "@/components/OrderStatus";

export const metadata: Metadata = { title: "حالة الطلب", robots: { index: false, follow: false } };

export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return (
    <Suspense fallback={<p className="py-16 text-center text-muted">جارٍ التحميل…</p>}>
      <OrderStatus number={decodeURIComponent(number)} />
    </Suspense>
  );
}
