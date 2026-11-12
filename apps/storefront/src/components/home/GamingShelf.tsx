"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { useOpenCart } from "@/components/CartDrawer";
import { Thumb } from "@/components/ProductGrid";
import { cart, CART_MAX_QTY, useCart, type CartLine } from "@/lib/cart";
import { egp, type ProductCard } from "@/lib/catalog";

type GamingProduct = ProductCard & { quickAdd?: Omit<CartLine, "qty"> };
type Group = { name: string; image: string; products: GamingProduct[] };

export default function GamingShelf({ groups }: { groups: Group[] }) {
  const [active, setActive] = useState(() => groups[3].products.length ? 3 : Math.max(0, groups.findIndex((group) => group.products.length > 0)));
  const rail = useRef<HTMLUListElement>(null);
  const { lines } = useCart();
  const openCart = useOpenCart();
  const selected = groups[active];

  function select(index: number) {
    setActive(index);
    rail.current?.scrollTo({ left: 0, behavior: "instant" });
  }

  function scroll(direction: number) {
    const row = rail.current;
    if (row) row.scrollBy({ left: direction * row.clientWidth * 0.8 });
  }

  return (
    <section id="gaming" aria-labelledby="gaming-title" className="scroll-mt-36">
      <header className="mb-4 text-center sm:mb-6">
        <p className="shop-kicker">للعب والتجهيز</p>
        <h2 id="gaming-title" className="text-2xl font-extrabold sm:text-4xl">جيمنج وإكسسوارات</h2>
      </header>
      <div dir="ltr" className="grid grid-cols-4 gap-1 px-2 sm:gap-4 sm:px-6">
        {groups.map((group) => (
          <div key={group.name} className="relative mx-auto h-[clamp(4.5rem,14vw,13rem)] w-full max-w-60 overflow-hidden">
            <Image src={group.image} alt="" fill sizes="(max-width: 768px) 24vw, 240px" className="object-cover object-top drop-shadow-[0_8px_10px_#0003]" />
          </div>
        ))}
      </div>
      <div className="gaming-shelf rounded-3xl p-3 text-white shadow-xl sm:p-6">
        <div dir="ltr" className="grid grid-cols-4 gap-1.5 sm:gap-3" role="group" aria-label="فلترة منتجات الجيمنج">
          {groups.map((group, index) => (
            <button
              key={group.name}
              type="button"
              dir="rtl"
              aria-controls="gaming-products"
              aria-pressed={active === index}
              onClick={() => select(index)}
              className="min-h-11 rounded-xl border border-white/50 bg-white px-1 py-1.5 text-[0.64rem] leading-snug font-extrabold text-slate-950 transition hover:bg-blue-100 aria-pressed:border-blue-200 aria-pressed:bg-blue-200 sm:px-3 sm:text-sm"
            >
              {group.name}
            </button>
          ))}
        </div>
        <div id="gaming-products" className="mt-4 sm:mt-6" aria-label={selected.name}>
          {selected.products.length ? (
            <>
              <ul ref={rail} className="gaming-rail shop-rail flex snap-x gap-3 overflow-x-auto px-1 pb-3 pt-1 sm:gap-4">
                {selected.products.map((product) => {
                  const item = product.quickAdd;
                  const qty = lines.find((line) => line.variant_id === item?.variant_id)?.qty ?? 0;
                  const limitReached = item && qty >= Math.min(CART_MAX_QTY, item.available ?? CART_MAX_QTY);
                  return (
                    <li key={product.id} className="flex w-42 shrink-0 snap-start flex-col gap-2 rounded-2xl border border-white/10 bg-[#171923] p-2.5 sm:w-52 sm:p-3">
                      <Link href={`/products/${product.id}`} className="group space-y-2">
                        <Thumb src={product.image_url} name={product.name} />
                        <h3 className="line-clamp-2 min-h-10 text-sm font-bold leading-5" dir="auto">{product.name}</h3>
                      </Link>
                      <p className="text-sm font-extrabold text-emerald-300">
                        {product.minPrice !== product.maxPrice && <span className="me-1 text-xs font-normal text-white/80">من</span>}
                        <bdi>{egp(product.minPrice)}</bdi>
                      </p>
                      {item ? (
                        <button type="button" aria-haspopup="dialog" aria-controls="cart-drawer" disabled={limitReached} onClick={() => {
                          cart.add(item);
                          openCart(item.name);
                        }} className="mt-auto rounded-lg bg-white px-2 py-2 text-xs font-bold text-slate-950 hover:bg-blue-100 disabled:opacity-60">
                          {limitReached ? "وصلت للحد الأقصى" : "أضف للسلة"}
                        </button>
                      ) : (
                        <Link href={`/products/${product.id}`} className="mt-auto rounded-lg bg-white px-2 py-2 text-center text-xs font-bold text-slate-950 hover:bg-blue-100">
                          {product.inStock ? "اختر الإصدار" : "عرض التفاصيل"}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
              {selected.products.length > 2 && (
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" aria-label="المنتجات السابقة" className="grid size-10 place-items-center rounded-full border border-white/45 hover:bg-white/15" onClick={() => scroll(1)}>→</button>
                  <button type="button" aria-label="المنتجات التالية" className="grid size-10 place-items-center rounded-full border border-white/45 hover:bg-white/15" onClick={() => scroll(-1)}>←</button>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/30 px-4 py-10 text-center">
              <p className="font-bold">مفيش منتجات منشورة هنا حاليًا</p>
              <Link href="/products" className="mt-2 inline-block text-sm text-blue-200 hover:underline">تصفح باقي المنتجات ←</Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
