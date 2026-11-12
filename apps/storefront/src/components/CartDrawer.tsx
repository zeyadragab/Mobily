"use client";

import Link from "next/link";
import Image from "next/image";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useCart } from "@/lib/cart";
import { egp } from "@/lib/catalog";
import CartQuantity from "./CartQuantity";

const CartDrawerContext = createContext<(added?: string) => void>(() => {});

export function useOpenCart() {
  return useContext(CartDrawerContext);
}

export default function CartDrawer({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [added, setAdded] = useState<string>();
  const { lines, count, total } = useCart();

  function open(name?: string) {
    const panel = dialog.current;
    if (!panel || panel.open) return;
    setAdded(name);
    panel.showModal();
    closeButton.current?.focus();
  }

  function close() {
    dialog.current?.close();
  }

  return (
    <CartDrawerContext.Provider value={open}>
      {children}
      <dialog
        ref={dialog}
        id="cart-drawer"
        aria-labelledby="cart-drawer-title"
        className="shop-dialog shop-drawer bg-surface text-fg"
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      >
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-line p-5 sm:p-6">
            <div>
              <h2 id="cart-drawer-title" className="text-2xl font-extrabold">سلة التسوق</h2>
              <p className="text-sm text-muted">الكمية الإجمالية · {count}</p>
            </div>
            <button ref={closeButton} type="button" aria-label="إغلاق السلة" className="shop-icon-button" onClick={close}>×</button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6">
            {added && (
              <p className="shop-feedback mb-4 rounded-2xl bg-ok/10 px-4 py-3 text-sm font-semibold text-ok" role="status">
                <span aria-hidden="true">✓ </span>تمت إضافة <bdi>{added}</bdi> إلى السلة
              </p>
            )}
            {lines.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">سلتك فارغة حاليًا.</p>
            ) : (
              <ul className="divide-y divide-line">
                {lines.map((line) => (
                  <li key={line.variant_id} className="flex items-start gap-3 py-4 first:pt-0">
                    {line.image_url && (
                      <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-white">
                        <Image src={line.image_url} alt="" fill sizes="56px" unoptimized={line.image_url.endsWith(".svg")} className="object-contain p-1" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <Link href={`/products/${line.product_id}`} onClick={close} className="font-bold hover:text-accent" dir="auto">
                        {line.name}
                      </Link>
                      <p className="pb-1 text-sm text-muted">{line.variant}</p>
                      <CartQuantity line={line} />
                    </div>
                    <bdi className="shrink-0 text-sm font-bold">{egp(line.qty * line.price)}</bdi>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <footer className="grid gap-3 border-t border-line p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
            {lines.length > 0 && (
              <>
                <div className="flex items-center justify-between gap-3 pb-2">
                  <span className="text-muted">الإجمالي</span>
                  <bdi className="text-xl font-extrabold">{egp(total)}</bdi>
                </div>
                <Link href="/checkout" onClick={close} className="btn-primary">متابعة الحجز</Link>
                <Link href="/cart" onClick={close} className="btn-ghost">عرض السلة وتعديل الكميات</Link>
              </>
            )}
            <button type="button" onClick={close} className="rounded-full p-2 text-sm font-semibold text-accent hover:underline">
              أكمل التسوق
            </button>
          </footer>
        </div>
      </dialog>
    </CartDrawerContext.Provider>
  );
}
