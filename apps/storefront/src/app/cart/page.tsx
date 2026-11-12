"use client";

import Link from "next/link";
import { cart, useCart } from "@/lib/cart";
import { egp } from "@/lib/catalog";
import CartQuantity from "@/components/CartQuantity";

export default function CartPage() {
  const { lines, total } = useCart();

  if (lines.length === 0) {
    return (
      <div className="card rise mx-auto max-w-md space-y-4 p-10 text-center">
        <span aria-hidden="true" className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-accent/10 text-4xl">
          🛒
        </span>
        <h1 className="text-2xl font-extrabold">السلة فارغة</h1>
        <p className="text-muted">أضف منتجات لتبدأ طلبك.</p>
        <Link href="/products" className="btn-primary btn-shine">
          تصفح المنتجات
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="space-y-4 lg:col-span-2">
        <h1 className="text-3xl font-extrabold">السلة</h1>
        <ul className="space-y-3">
          {lines.map((l) => (
            <li key={l.variant_id} className="card rise flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <Link href={`/products/${l.product_id}`} className="font-bold hover:text-accent" dir="auto">
                  {l.name}
                </Link>
                <p className="text-sm text-muted">{l.variant}</p>
                <p className="mt-1 text-sm">{egp(l.price)}</p>
              </div>
              <CartQuantity line={l} />
              <p className="w-28 text-end text-lg font-extrabold">{egp(l.price * l.qty)}</p>
              <button className="rounded-full px-3 py-1 text-sm text-danger transition hover:bg-danger/10" onClick={() => cart.setQty(l.variant_id, 0)}>
                حذف
              </button>
            </li>
          ))}
        </ul>
      </section>

      <aside className="card h-fit space-y-4 p-6 lg:sticky lg:top-36">
        <h2 className="text-lg font-extrabold">ملخص الطلب</h2>
        <div className="flex items-end justify-between border-t border-line pt-4">
          <span className="text-muted">الإجمالي</span>
          <span className="text-2xl font-extrabold">{egp(total)}</span>
        </div>
        <p className="text-xs leading-5 text-muted">
          الشحن (لو توصيل) يُحدد عند التأكيد. السعر والتوافر يُعاد التحقق منهما عند الحجز. لا يتم أي دفع الآن.
        </p>
        <Link href="/checkout" className="btn-primary btn-shine w-full">
          متابعة الحجز
        </Link>
        <Link href="/products" className="block text-center text-sm font-medium text-accent hover:underline">
          إكمال التسوق
        </Link>
      </aside>
    </div>
  );
}
