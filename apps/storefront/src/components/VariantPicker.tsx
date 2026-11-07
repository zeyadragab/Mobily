"use client";

import Link from "next/link";
import { useState } from "react";
import { cart, CART_MAX_QTY, useCart } from "@/lib/cart";
import { CONDITION_AR, egp, variantTitle } from "@/lib/catalog";

type V = {
  variant_id: string;
  product_id: string;
  name: string;
  color: string | null;
  storage: string | null;
  condition: "new" | "used" | "refurbished";
  price: number;
  available: number;
};

export default function VariantPicker({ items }: { items: V[] }) {
  const firstInStock = items.find((i) => i.available > 0) ?? items[0];
  const [sel, setSel] = useState(firstInStock.variant_id);
  const [added, setAdded] = useState(false);
  const { lines } = useCart();
  const v = items.find((i) => i.variant_id === sel) ?? items[0];
  const inCart = lines.find((l) => l.variant_id === v.variant_id)?.qty ?? 0;
  const canAdd = v.available > 0 && inCart < Math.min(CART_MAX_QTY, v.available);

  function add() {
    cart.add({ variant_id: v.variant_id, product_id: v.product_id, name: v.name, variant: variantTitle(v), price: v.price });
    setAdded(true);
  }

  return (
    <div className="card space-y-5 p-5">
      <p key={v.variant_id} className="rise bg-(image:--brand-gradient) bg-clip-text text-4xl font-extrabold text-transparent">
        {egp(v.price)}
      </p>

      {items.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-muted">اختر الإصدار</legend>
          <div className="flex flex-wrap gap-2">
            {items.map((i) => (
              <label
                key={i.variant_id}
                className={`cursor-pointer rounded-2xl border px-4 py-2.5 text-sm font-medium transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                  sel === i.variant_id
                    ? "border-accent bg-accent/10 text-accent ring-2 ring-accent/30"
                    : "border-line bg-surface hover:border-accent"
                } ${i.available === 0 ? "opacity-60" : ""}`}
              >
                <input
                  type="radio"
                  name="variant"
                  className="sr-only"
                  checked={sel === i.variant_id}
                  onChange={() => {
                    setSel(i.variant_id);
                    setAdded(false);
                  }}
                />
                {variantTitle(i)}
                {i.available === 0 && <span className="ms-1 text-xs">(غير متوفر)</span>}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <p className="flex flex-wrap items-center gap-2 text-sm" role="status">
        {v.available === 0 ? (
          <span className="rounded-full bg-danger/10 px-3 py-1 font-semibold text-danger">غير متوفر حاليًا</span>
        ) : v.available <= 2 ? (
          <span className="rounded-full bg-warn/10 px-3 py-1 font-semibold text-warn">
            كمية محدودة ({v.available === 1 ? "قطعة واحدة" : "قطعتان"} فقط)
          </span>
        ) : (
          <span className="rounded-full bg-ok/10 px-3 py-1 font-semibold text-ok">متوفر</span>
        )}
        <span className="text-muted">الحالة: {CONDITION_AR[v.condition]}</span>
      </p>

      <div className="flex flex-wrap gap-3">
        <button onClick={add} disabled={!canAdd} className="btn-primary btn-shine flex-1 sm:flex-none">
          {v.available === 0 ? "غير متوفر" : canAdd ? "أضف للسلة" : "وصلت للحد الأقصى"}
        </button>
        {added && (
          <Link href="/cart" className="btn-ghost rise">
            عرض السلة ←
          </Link>
        )}
      </div>
      <p className="text-xs text-muted">الحجز لمدة 24 ساعة. يؤكد المحل الطلب معك قبل التسليم، ولا يتم الدفع أونلاين.</p>
    </div>
  );
}
