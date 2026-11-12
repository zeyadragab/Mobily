"use client";

import { cart, CART_MAX_QTY, type CartLine } from "@/lib/cart";

export default function CartQuantity({ line }: { line: CartLine }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-line bg-bg p-1" role="group" aria-label={`كمية ${line.name}`}>
      <button
        type="button"
        aria-label={line.qty === 1 ? "إزالة المنتج" : "تقليل الكمية"}
        className="size-9 rounded-full text-lg transition hover:bg-surface"
        onClick={() => cart.setQty(line.variant_id, line.qty - 1)}
      >
        −
      </button>
      <span className="w-7 text-center text-sm font-bold" aria-live="polite">{line.qty}</span>
      <button
        type="button"
        aria-label="زيادة الكمية"
        disabled={line.qty >= Math.min(CART_MAX_QTY, line.available ?? CART_MAX_QTY)}
        className="size-9 rounded-full text-lg transition hover:bg-surface disabled:opacity-40"
        onClick={() => cart.setQty(line.variant_id, line.qty + 1)}
      >
        +
      </button>
    </div>
  );
}
