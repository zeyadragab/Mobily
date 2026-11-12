"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { PROMO_BANNERS } from "@/lib/site-images";

export default function PromoBanners() {
  const rail = useRef<HTMLUListElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState<(typeof PROMO_BANNERS)[number]>();
  const railId = useId();
  const dialogId = useId();
  const titleId = useId();

  function scroll(direction: number) {
    const el = rail.current;
    const first = el?.children[0];
    const second = el?.children[1];
    if (!el || !first || !second) return;
    const step = Math.abs(first.getBoundingClientRect().left - second.getBoundingClientRect().left);
    el.scrollBy({ left: -direction * step });
  }

  return (
    <section id="store-offers" aria-label="عروض الماركات" className="scroll-mt-36 space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="shop-kicker">مختارات المتجر</p>
          <h2 className="text-2xl font-extrabold sm:text-3xl">عروض وإعلانات الماركات</h2>
        </div>
        <div className="flex gap-2">
          <button type="button" className="shop-icon-button" aria-controls={railId} aria-label="الإعلان السابق" onClick={() => scroll(-1)}>→</button>
          <button type="button" className="shop-icon-button" aria-controls={railId} aria-label="الإعلان التالي" onClick={() => scroll(1)}>←</button>
        </div>
      </div>
      <ul id={railId} ref={rail} className="shop-rail flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 sm:gap-4">
        {PROMO_BANNERS.map((b) => (
          <li key={b.src} className="w-[88%] shrink-0 snap-start sm:w-[62%] lg:w-[48%]">
            <button
              type="button"
              aria-label={`عرض إعلان ${b.alt}`}
              aria-haspopup="dialog"
              aria-controls={dialogId}
              onClick={() => {
                setActive(b);
                dialog.current?.showModal();
                closeButton.current?.focus();
              }}
              className="group relative block w-full cursor-pointer overflow-hidden rounded-3xl border border-line bg-surface text-start shadow-(--shadow-card) focus-visible:outline-offset-[-4px]"
            >
              <Image
                src={b.src}
                alt={b.alt}
                width={2000}
                height={894}
                sizes="(max-width: 640px) 88vw, (max-width: 1024px) 62vw, 48vw"
                className="aspect-[2.23] w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
              />
              <span className="absolute end-3 bottom-3 rounded-full bg-slate-950/85 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                عرض الإعلان ↗
              </span>
            </button>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        id={dialogId}
        aria-labelledby={titleId}
        className="shop-dialog shop-popup bg-surface text-fg"
        onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      >
        <div className="space-y-4 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 id={titleId} className="text-xl font-extrabold sm:text-2xl">{active?.alt}</h2>
            <button ref={closeButton} type="button" aria-label="إغلاق الإعلان" className="shop-icon-button" onClick={() => dialog.current?.close()}>×</button>
          </div>
          {active && (
            <>
              <Image src={active.src} alt={active.alt} width={2000} height={894} sizes="(max-width: 768px) 90vw, 700px" className="h-auto w-full rounded-2xl" />
              <Link href={active.href} onClick={() => dialog.current?.close()} className="btn-primary">تصفح المنتجات ←</Link>
            </>
          )}
        </div>
      </dialog>
    </section>
  );
}
