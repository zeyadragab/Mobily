import Image from "next/image";
import Link from "next/link";
import Parallax from "./motion/Parallax";
import { SITE_IMAGES } from "@/lib/site-images";

const CHIPS = [
  { t: "ضمان حقيقي", cls: "end-[50%] top-[14%]", delay: 0, r: "-6deg" },
  { t: "حجز مجاني 24 ساعة", cls: "end-[58%] top-[42%]", delay: 2, r: "5deg" },
  { t: "استلام أو توصيل", cls: "end-[50%] bottom-[14%]", delay: 4, r: "-3deg" },
];

/** First screen: full photo, headline, two clear actions. The photo drifts slowly on scroll. */
export default function Hero() {
  return (
    <section aria-label="مرحبًا" className="relative isolate min-h-136 overflow-hidden rounded-[2rem] bg-slate-950 text-white sm:min-h-128">
      <Parallax speed={0.08} className="absolute -inset-y-10 inset-x-0 -z-20">
        <Image
          src={SITE_IMAGES.hero}
          alt="هاتف قابل للطي بلون بنفسجي"
          fill
          priority
          sizes="(max-width: 1280px) 100vw, 1280px"
          className="object-cover object-[12%_center]"
        />
      </Parallax>
      {/* Keeps the text readable: dark at the text side (right), clear at the phone side (left). */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-b from-slate-950/90 via-slate-950/55 to-slate-950/20 lg:bg-linear-to-l lg:from-slate-950/85 lg:via-slate-950/45 lg:to-transparent" />

      <div className="grid min-h-inherit items-center px-5 py-10 sm:px-12 sm:py-14 lg:min-h-128 lg:grid-cols-2">
        <div className="space-y-4 text-center sm:space-y-5 lg:text-start">
          <p style={{ "--delay": 0 } as React.CSSProperties} className="rise mx-auto w-fit rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-medium backdrop-blur lg:mx-0 sm:text-sm">
            ✦ أحدث الموديلات وصلت
          </p>
          <h1 style={{ "--delay": 1 } as React.CSSProperties} className="rise text-3xl font-extrabold leading-[1.2] sm:text-5xl lg:text-6xl">
            موبايلك الجديد
            <br />
            <span className="bg-linear-to-l from-violet-200 to-white bg-clip-text text-transparent">بسعر واضح وضمان حقيقي</span>
          </h1>
          <p style={{ "--delay": 2 } as React.CSSProperties} className="rise mx-auto max-w-md text-base text-white/85 sm:text-lg lg:mx-0">
            اختر جهازك، احجزه في دقيقة، واستلمه من المحل أو يوصلك لحد البيت.
          </p>
          <div style={{ "--delay": 3 } as React.CSSProperties} className="rise flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <Link href="/products" className="btn-shine rounded-full bg-white px-8 py-3.5 text-center font-bold text-blue-800 shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0">
              تصفح المنتجات
            </Link>
            <Link href="/track" className="rounded-full border border-white/40 px-8 py-3.5 text-center font-semibold backdrop-blur transition hover:bg-white/10">
              تتبع طلبي
            </Link>
          </div>
        </div>
      </div>

      {/* Floating badges sit over the phone side on large screens. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-0 hidden w-1/2 lg:block">
        {CHIPS.map((c) => (
          <span
            key={c.t}
            style={{ "--delay": c.delay, "--r": c.r } as React.CSSProperties}
            className={`float absolute ${c.cls} rounded-2xl border border-white/30 bg-white/15 px-3 py-2 text-sm font-semibold shadow-lg backdrop-blur`}
          >
            {c.t}
          </span>
        ))}
      </div>
    </section>
  );
}
