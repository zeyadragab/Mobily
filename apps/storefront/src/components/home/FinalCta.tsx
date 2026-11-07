import Image from "next/image";
import Link from "next/link";
import { SITE_IMAGES } from "@/lib/site-images";
import Reveal from "../motion/Reveal";
import Parallax from "../motion/Parallax";

/** Closing banner: text and buttons on one side, a big phone photo on the other. */
export default function FinalCta() {
  return (
    <Reveal scale={0.97}>
      <section
        aria-label="ابدأ الآن"
        className="card relative isolate grid overflow-hidden rounded-[2rem] lg:min-h-96 lg:grid-cols-5"
      >
        <div aria-hidden="true" className="blob absolute -start-24 -top-24 -z-10 h-72 w-72 rounded-full bg-blue-300/30 blur-3xl" />
        <div aria-hidden="true" className="blob absolute -bottom-24 start-1/3 -z-10 h-72 w-72 rounded-full bg-orange-300/30 blur-3xl [animation-delay:-6s]" />

        <div className="flex flex-col justify-center gap-4 p-7 text-center sm:p-12 lg:col-span-2 lg:text-start">
          <p className="mx-auto w-fit rounded-full bg-accent/10 px-4 py-1.5 text-sm font-semibold text-accent lg:mx-0">متوفر الآن</p>
          <h2 className="text-3xl font-extrabold leading-tight sm:text-4xl">جاهز تختار جهازك الجديد؟</h2>
          <p className="text-muted">احجز الآن مجانًا، ونحن نحجز لك القطعة 24 ساعة.</p>
          <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row lg:justify-start">
            <Link href="/products" className="btn-primary btn-shine">
              تصفح المنتجات
            </Link>
            <Link href="/track" className="btn-ghost">
              تتبع طلبي
            </Link>
          </div>
        </div>

        <div className="relative order-first aspect-[2000/894] overflow-hidden lg:order-none lg:col-span-3 lg:aspect-auto">
          <Parallax speed={-0.05} className="absolute inset-0 lg:-inset-y-8">
            <Image
              src={SITE_IMAGES.cta}
              alt="فيفو V80 بلون برتقالي"
              fill
              sizes="(max-width: 1024px) 100vw, 60vw"
              className="object-cover lg:origin-right lg:scale-[1.07] lg:object-right"
            />
          </Parallax>
          {/* Soft fade into the text side so the white photo background blends with the card. */}
          <div aria-hidden="true" className="absolute inset-y-0 start-0 hidden w-24 bg-linear-to-l from-surface to-transparent lg:block" />
        </div>
      </section>
    </Reveal>
  );
}
