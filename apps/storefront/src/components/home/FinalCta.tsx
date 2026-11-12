import Image from "next/image";
import Link from "next/link";
import Reveal from "../motion/Reveal";

/** Closing banner: copy on the start side, a large phone photo fading in from the end side. */
export default function FinalCta() {
  return (
    <Reveal scale={0.97}>
      <section
        id="choose-device"
        aria-label="ابدأ الآن"
        className="card relative isolate overflow-hidden rounded-3xl bg-linear-to-br from-white via-white to-blue-50 text-slate-950 md:min-h-80"
      >
        <div aria-hidden="true" className="pointer-events-none absolute -end-24 top-1/2 -z-10 size-[28rem] -translate-y-1/2 rounded-full bg-orange-200/40 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -start-24 -top-24 -z-10 size-72 rounded-full bg-blue-200/50 blur-3xl" />

        {/* Photo: white background is multiplied away and the inner edge is faded, so no box shows. */}
        <div className="relative h-48 sm:h-60 md:absolute md:inset-y-0 md:left-0 md:h-auto md:w-[58%]">
          <Image
            src="/img/closing-phone.png"
            alt="يد تحمل هاتفًا بلون نحاسي"
            fill
            sizes="(min-width: 768px) 58vw, 100vw"
            className="object-cover mix-blend-multiply [mask-image:linear-gradient(to_bottom,#000_70%,transparent)] md:[mask-image:linear-gradient(to_left,transparent,#000_35%)]"
          />
        </div>

        <div className="relative space-y-3 px-6 pb-8 text-center md:w-[46%] md:px-10 md:py-14 md:text-start">
          <p className="inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800 sm:text-sm">
            حجز مجاني لمدة 24 ساعة
          </p>
          <h2 className="text-3xl font-extrabold leading-tight sm:text-4xl">جاهز تختار جهازك الجديد؟</h2>
          <p className="text-sm text-slate-600 sm:text-base">اختار جهازك وشوف السعر والتوافر قبل ما تحجز.</p>
          <div className="flex flex-wrap justify-center gap-3 pt-2 md:justify-start">
            <Link href="/products" className="btn-primary btn-shine px-6 py-3 text-sm sm:text-base">
              تصفح المنتجات
            </Link>
            <Link href="/track" className="btn-ghost bg-white px-6 py-3 text-sm text-slate-950 sm:text-base">
              تتبع طلبي
            </Link>
          </div>
        </div>
      </section>
    </Reveal>
  );
}
