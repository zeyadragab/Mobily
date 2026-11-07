"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { PROMO_BANNERS } from "@/lib/site-images";

/** Swipeable banner strip with arrows. Moves by itself every 5s; stops on hover/focus and for reduced motion. */
export default function PromoBanners() {
  const ref = useRef<HTMLUListElement>(null);
  const paused = useRef(false);

  // dir 1 = next (leftwards in this RTL page), -1 = previous
  const go = useCallback((dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const atEnd = Math.abs(el.scrollLeft) + el.clientWidth >= el.scrollWidth - 6;
    if (dir === 1 && atEnd) el.scrollTo({ left: 0, behavior: "smooth" });
    else el.scrollBy({ left: -dir * el.clientWidth * 0.8, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => !paused.current && go(1), 5000);
    return () => clearInterval(id);
  }, [go]);

  const arrow = "absolute top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-lg shadow-lg backdrop-blur transition hover:scale-110 sm:flex";

  return (
    <section
      aria-roledescription="carousel"
      aria-label="عروض الماركات"
      className="relative"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onFocus={() => (paused.current = true)}
      onBlur={() => (paused.current = false)}
    >
      <ul ref={ref} className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:gap-4 [&::-webkit-scrollbar]:hidden">
        {PROMO_BANNERS.map((b, i) => (
          <li key={b.src} className="w-[88%] shrink-0 snap-center sm:w-[62%] lg:w-[48%]">
            <Link href={b.href} className="group block overflow-hidden rounded-3xl border border-line bg-surface shadow-(--shadow-card)">
              <Image
                src={b.src}
                alt={b.alt}
                width={2000}
                height={894}
                sizes="(max-width: 640px) 88vw, (max-width: 1024px) 62vw, 48vw"
                priority={i < 2}
                className="h-auto w-full transition-transform duration-700 ease-out group-hover:scale-105"
              />
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" aria-label="السابق" onClick={() => go(-1)} className={`${arrow} end-auto start-2`}>
        <span aria-hidden="true">→</span>
      </button>
      <button type="button" aria-label="التالي" onClick={() => go(1)} className={`${arrow} start-auto end-2`}>
        <span aria-hidden="true">←</span>
      </button>
    </section>
  );
}
