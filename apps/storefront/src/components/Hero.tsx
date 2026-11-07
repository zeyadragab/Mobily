"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Editable slides. Replace the text (and later add an image) from the admin once banners are managed there.
const SLIDES = [
  { title: "موبايلات بأسعار واضحة", text: "أحدث الموديلات بضمان حقيقي. اختر واحجز في دقيقة.", cta: "تصفح الموبايلات", href: "/products", tone: "from-blue-700 to-blue-500" },
  { title: "احجز وأنت في بيتك", text: "نحجز لك القطعة 24 ساعة ونؤكد معك الطلب.", cta: "كيف يعمل الحجز؟", href: "/track", tone: "from-indigo-700 to-sky-500" },
  { title: "إكسسوارات وشواحن", text: "كل ما يحتاجه جهازك من شواحن وكابلات وسماعات.", cta: "شاهد الإكسسوارات", href: "/products", tone: "from-slate-800 to-blue-600" },
];

export default function Hero() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((v) => (v + 1) % SLIDES.length), 5500);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="العروض"
      className="relative h-48 overflow-hidden rounded-3xl sm:h-72"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {SLIDES.map((s, n) => (
        <div
          key={s.title}
          aria-hidden={n !== i}
          className={`absolute inset-0 flex flex-col justify-center gap-3 bg-linear-to-l ${s.tone} px-6 text-white transition-opacity duration-700 sm:px-12 ${n === i ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <h2 className="max-w-md text-2xl font-extrabold leading-tight sm:text-4xl">{s.title}</h2>
          <p className="max-w-md text-sm text-white/85 sm:text-base">{s.text}</p>
          <Link href={s.href} tabIndex={n === i ? 0 : -1} className="w-fit rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-blue-700">
            {s.cta}
          </Link>
        </div>
      ))}
      <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
        {SLIDES.map((s, n) => (
          <button
            key={s.title}
            aria-label={`الشريحة ${n + 1}`}
            aria-current={n === i}
            onClick={() => setI(n)}
            className={`h-2 rounded-full transition-all ${n === i ? "w-6 bg-white" : "w-2 bg-white/50"}`}
          />
        ))}
      </div>
    </section>
  );
}
