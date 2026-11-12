"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { PROMO_BANNERS, SHOWCASE_PHONES, SITE_IMAGES } from "@/lib/site-images";

const CAMPAIGNS = [
  { src: SITE_IMAGES.hero, alt: "سامسونج جالاكسي زد فولد", href: "/products?q=Samsung" },
  PROMO_BANNERS[1],
  PROMO_BANNERS[0],
  PROMO_BANNERS[3],
];
const COUNT = CAMPAIGNS.length;
const TRACK = [...CAMPAIGNS, ...CAMPAIGNS, ...CAMPAIGNS];
const MOTION = "(prefers-reduced-motion: reduce)";
const SIDE_FEATURES = [SHOWCASE_PHONES[1], SHOWCASE_PHONES[3], SHOWCASE_PHONES[5], SHOWCASE_PHONES[6]];

function observeMedia(query: string, notify: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

function observeMotion(notify: () => void) {
  return observeMedia(MOTION, notify);
}

function wrap(index: number) {
  return ((index % COUNT) + COUNT) % COUNT;
}

function SideFeature({ phone }: { phone: (typeof SIDE_FEATURES)[number] }) {
  return (
    <Link href={`/products?q=${encodeURIComponent(phone.q ?? phone.brand)}`} className="group relative hidden min-w-0 flex-col justify-end overflow-hidden rounded-2xl border border-line bg-surface md:flex">
      <div className="relative min-h-0 flex-1">
        <Image src={phone.front} alt="" fill sizes="18vw" className="hero-image object-contain p-2 transition-transform duration-300 group-hover:scale-105 lg:p-4" />
      </div>
      <div className="bg-bg px-3 py-2 text-center lg:py-3">
        <p className="truncate text-xs font-extrabold lg:text-sm">{phone.name}</p>
        <span className="mt-1 inline-block text-xs font-bold text-accent group-hover:underline">تسوّق الآن ←</span>
      </div>
    </Link>
  );
}

export default function Hero() {
  const [position, setPosition] = useState(COUNT);
  const [moving, setMoving] = useState(false);
  const [playing, setPlaying] = useState(true);
  const region = useRef<HTMLElement>(null);
  const touchStart = useRef<number | null>(null);
  const reduced = useSyncExternalStore(observeMotion, () => window.matchMedia(MOTION).matches, () => false);
  const active = wrap(position);

  const move = useCallback((offset: number) => {
    if (moving || !offset) return;
    setMoving(!reduced);
    setPosition((current) => reduced ? COUNT + wrap(current + offset) : current + offset);
  }, [moving, reduced]);

  useEffect(() => {
    if (!moving) return;
    // Also settle when the tab was hidden or the motion preference changed mid-transition.
    const timer = window.setTimeout(() => {
      setMoving(false);
      setPosition((current) => COUNT + wrap(current));
    }, reduced ? 0 : 620);
    return () => window.clearTimeout(timer);
  }, [moving, reduced]);

  useEffect(() => {
    if (!playing || reduced || moving) return;
    const timer = window.setInterval(() => {
      const carousel = region.current;
      if (!document.hidden && carousel && !carousel.matches(":hover, :focus-within")) move(1);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [playing, reduced, moving, move]);

  return (
    <section ref={region} aria-label="أبرز اختيارات المتجر" className="w-full space-y-2.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="shop-kicker">أحدث الأجهزة وعروض الماركات</p>
          <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">موبايلك الجديد يبدأ هنا</h1>
        </div>
        <Link href="/products" className="text-sm font-bold text-accent hover:underline">تصفح المنتجات ←</Link>
      </div>

      <div
        className="hero-window"
        onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          const end = event.changedTouches[0]?.clientX;
          const start = touchStart.current;
          touchStart.current = null;
          if (start !== null && end !== undefined && Math.abs(end - start) > 45) move(end > start ? 1 : -1);
        }}
      >
        <ul className="hero-track" data-moving={moving} style={{ "--hero-position": position } as CSSProperties}>
          {TRACK.map((campaign, index) => {
            const visible = index === position;
            return (
              <li key={index} className="hero-card grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,4fr)_minmax(0,1fr)] lg:gap-3" aria-hidden={!visible} inert={!visible}>
                <SideFeature phone={SIDE_FEATURES[wrap(index)]} />
                <Link href={campaign.href} className="group relative isolate flex h-full flex-col justify-end overflow-hidden rounded-3xl bg-slate-950 p-4 text-white focus-visible:outline-offset-[-4px] sm:p-7 lg:p-10">
                  <Image
                    src={campaign.src}
                    alt=""
                    fill
                    preload={index === COUNT}
                    loading={index === COUNT ? undefined : "lazy"}
                    sizes="(max-width: 767px) 96vw, (max-width: 1777px) 60vw, 1060px"
                    className="hero-image -z-20 object-contain object-top md:object-cover md:object-center"
                  />
                  <span aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-linear-to-t from-slate-950/95 to-transparent" />
                  <span className="text-sm font-extrabold sm:text-2xl">{campaign.alt}</span>
                  <span className="mt-1 text-xs font-medium text-white/90 sm:text-sm">تصفح المنتجات ←</span>
                </Link>
                <SideFeature phone={SIDE_FEATURES[wrap(index + 2)]} />
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex items-center justify-center gap-2">
        <div className="flex gap-2">
          <button type="button" aria-label="البانر السابق" onClick={() => move(-1)} className="shop-icon-button size-8">→</button>
        </div>
        <div className="flex gap-1" aria-label="اختيار البانر">
          {CAMPAIGNS.map((campaign, index) => (
            <button key={campaign.src} type="button" aria-label={campaign.alt} aria-pressed={active === index} onClick={() => {
              const distance = wrap(index - active);
              move(distance > COUNT / 2 ? distance - COUNT : distance);
            }} className="group grid size-8 place-items-center rounded-full">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-muted/40 transition-all group-aria-pressed:w-5 group-aria-pressed:bg-accent" />
            </button>
          ))}
        </div>
        <button type="button" aria-label="البانر التالي" onClick={() => move(1)} className="shop-icon-button size-8">←</button>
        <button type="button" aria-label={playing ? "إيقاف الحركة التلقائية" : "تشغيل الحركة التلقائية"} hidden={reduced} onClick={() => setPlaying(!playing)} className="shop-icon-button size-8">
          <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
        </button>
      </div>
    </section>
  );
}
