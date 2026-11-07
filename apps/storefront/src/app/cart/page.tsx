"use client";

import Link from "next/link";
import { cart, CART_MAX_QTY, useCart } from "@/lib/cart";
import { egp } from "@/lib/catalog";

export default function CartPage() {
  const { lines, total } = useCart();

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <h1 className="text-2xl font-bold">السلة فارغة</h1>
        <p className="text-muted">أضف منتجات لتبدأ طلبك.</p>
        <Link href="/products" className="inline-block rounded-xl bg-accent px-6 py-3 font-semibold text-accent-fg">
          تصفح المنتجات
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="space-y-3 lg:col-span-2">
        <h1 className="text-2xl font-bold">السلة</h1>
        <ul className="space-y-3">
          {lines.map((l) => (
            <li key={l.variant_id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-4">
              <div className="min-w-0 flex-1">
                <Link href={`/products/${l.product_id}`} className="font-semibold hover:underline" dir="auto">
                  {l.name}
                </Link>
                <p className="text-sm text-muted">{l.variant}</p>
                <p className="mt-1 text-sm">{egp(l.price)}</p>
              </div>
              <div className="flex items-center gap-1" role="group" aria-label="الكمية">
                <button
                  aria-label="تقليل"
                  className="h-9 w-9 rounded-lg border border-line hover:bg-bg"
                  onClick={() => cart.setQty(l.variant_id, l.qty - 1)}
                >
                  −
                </button>
                <span className="w-8 text-center font-semibold" aria-live="polite">
                  {l.qty}
                </span>
                <button
                  aria-label="زيادة"
                  disabled={l.qty >= CART_MAX_QTY}
                  className="h-9 w-9 rounded-lg border border-line hover:bg-bg disabled:opacity-40"
                  onClick={() => cart.setQty(l.variant_id, l.qty + 1)}
                >
                  +
                </button>
              </div>
              <p className="w-24 text-end font-bold">{egp(l.price * l.qty)}</p>
              <button className="text-sm text-danger" onClick={() => cart.setQty(l.variant_id, 0)}>
                حذف
              </button>
            </li>
          ))}
        </ul>
      </section>

      <aside className="h-fit space-y-3 rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-bold">ملخص الطلب</h2>
        <div className="flex justify-between text-sm">
          <span className="text-muted">الإجمالي</span>
          <span className="text-xl font-bold">{egp(total)}</span>
        </div>
        <p className="text-xs text-muted">
          الشحن (لو توصيل) يُحدد عند التأكيد. السعر والتوافر يُعاد التحقق منهما عند الحجز.
        </p>
        <Link href="/checkout" className="block rounded-xl bg-accent py-3 text-center font-semibold text-accent-fg">
          متابعة الحجز
        </Link>
      </aside>
    </div>
  );
}
