import Link from "next/link";
import Reveal from "../motion/Reveal";

const STEPS = [
  { n: "١", t: "اختر جهازك", d: "تصفح الأقسام، قارن الألوان والسعات، وشوف السعر والتوافر فورًا." },
  { n: "٢", t: "احجزه مجانًا", d: "اكتب بياناتك وهنحجز لك القطعة 24 ساعة بدون أي دفع مقدم." },
  { n: "٣", t: "استلم أو اطلب توصيل", d: "نؤكد معاك الطلب، وتستلمه من المحل أو يوصلك لحد بابك." },
];

/** Left column stays pinned while the steps scroll past (desktop). */
export default function HowItWorks() {
  return (
    <section aria-label="كيف يعمل الحجز" className="grid gap-8 rounded-[2rem] border border-line bg-surface p-6 shadow-(--shadow-card) sm:p-10 lg:grid-cols-2 lg:gap-16">
      <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
        <Reveal>
          <p className="text-sm font-semibold text-accent">ببساطة</p>
          <h2 className="mt-1 text-3xl font-extrabold leading-tight sm:text-4xl">ثلاث خطوات وجهازك جاهز</h2>
          <p className="mt-3 max-w-sm text-muted">بدون تعقيد وبدون مفاجآت. السعر اللي تشوفه هو السعر اللي تدفعه.</p>
          <Link href="/products" className="btn-shine mt-6 inline-block rounded-full bg-(image:--brand-gradient) px-8 py-3 font-semibold text-white shadow-lg transition hover:-translate-y-0.5">
            ابدأ الآن
          </Link>
        </Reveal>
      </div>
      <ol className="space-y-4">
        {STEPS.map((s, i) => (
          <li key={s.n}>
            <Reveal delay={i}>
              <div className="flex gap-4 rounded-3xl border border-line bg-bg p-5 transition hover:-translate-y-1 hover:border-accent sm:p-6">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-(image:--brand-gradient) text-xl font-extrabold text-white">{s.n}</span>
                <div>
                  <h3 className="text-lg font-bold">{s.t}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{s.d}</p>
                </div>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}
