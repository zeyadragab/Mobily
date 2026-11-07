import Link from "next/link";
import Reveal from "../motion/Reveal";

export default function FinalCta() {
  return (
    <Reveal scale={0.97}>
      <section aria-label="ابدأ الآن" className="relative isolate overflow-hidden rounded-[2rem] bg-linear-to-bl from-blue-700 to-slate-950 px-6 py-14 text-center text-white sm:py-20">
        <div aria-hidden="true" className="blob absolute -start-20 -top-20 -z-10 h-72 w-72 rounded-full bg-sky-400/30 blur-3xl" />
        <div aria-hidden="true" className="blob absolute -bottom-24 -end-16 -z-10 h-80 w-80 rounded-full bg-indigo-500/30 blur-3xl [animation-delay:-6s]" />
        <h2 className="mx-auto max-w-xl text-3xl font-extrabold leading-tight sm:text-5xl">جاهز تختار جهازك الجديد؟</h2>
        <p className="mx-auto mt-3 max-w-md text-white/80">احجز الآن مجانًا، ونحن نحجز لك القطعة 24 ساعة.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/products" className="btn-shine rounded-full bg-white px-10 py-3.5 font-bold text-blue-800 shadow-lg transition hover:-translate-y-0.5">
            تصفح المنتجات
          </Link>
          <Link href="/track" className="rounded-full border border-white/40 px-10 py-3.5 font-semibold transition hover:bg-white/10">
            تتبع طلبي
          </Link>
        </div>
      </section>
    </Reveal>
  );
}
