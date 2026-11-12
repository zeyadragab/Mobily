import Link from "next/link";
import Reveal from "../motion/Reveal";

const STEPS = [
  { n: "١", t: "اختر جهازك", d: "تصفح الأقسام، قارن الألوان والسعات، وشوف السعر والتوافر فورًا.", art: "M25 12h28a5 5 0 0 1 5 5v45a5 5 0 0 1-5 5H25a5 5 0 0 1-5-5V17a5 5 0 0 1 5-5Zm9 8h10m-7 39h4m-9-21 5 5 10-11" },
  { n: "٢", t: "احجزه مجانًا", d: "اكتب بياناتك وهنحجز لك القطعة 24 ساعة بدون أي دفع مقدم.", art: "M29 19h-7v48h36V19h-7m-22-5h22v12H29zm0 23h22m-22 9h13m-12 10 5 5 12-12" },
  { n: "٣", t: "استلم أو اطلب توصيل", d: "نؤكد معاك الطلب، وتستلمه من المحل أو يوصلك لحد بابك.", art: "m16 27 24-13 24 13v30L40 69 16 57zm0 0 24 13 24-13M40 40v29m-9-51 24 13v13" },
];

export default function HowItWorks() {
  return (
    <section aria-labelledby="reservation-flow-title" className="mx-auto max-w-6xl space-y-6 py-2 sm:space-y-8">
      <Reveal className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="shop-kicker">الحجز أونلاين</p>
          <h2 id="reservation-flow-title" className="mt-1 text-2xl font-extrabold leading-tight sm:text-3xl">ثلاث خطوات وجهازك جاهز</h2>
        </div>
        <Link href="/products" className="text-sm font-bold text-accent hover:underline">ابدأ التسوق ←</Link>
      </Reveal>
      <ol className="relative grid gap-5 before:absolute before:start-[0.95rem] before:inset-y-4 before:border-s before:border-dashed before:border-accent/35 md:grid-cols-3 md:gap-8 md:before:inset-x-4 md:before:top-[0.95rem] md:before:bottom-auto md:before:border-s-0 md:before:border-t">
        {STEPS.map((s, i) => (
          <li key={s.n}>
            <Reveal delay={i}>
              <div className="step-card relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:gap-y-3">
                <span className="grid size-8 place-items-center rounded-full bg-accent text-sm font-extrabold text-accent-fg md:col-span-2">{s.n}</span>
                <div className="min-w-0">
                  <h3 className="font-bold">{s.t}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{s.d}</p>
                </div>
                <svg aria-hidden="true" viewBox="0 0 80 80" className="step-art size-10 text-accent sm:size-12">
                  <circle cx="40" cy="40" r="37" fill="currentColor" opacity=".09" />
                  <path d={s.art} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M64 11v10m-5-5h10M13 50v8m-4-4h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".55" />
                </svg>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}
