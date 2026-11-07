import Image from "next/image";
import { BRAND_LOGOS } from "@/lib/site-images";

/** Endless slow strip of brand logos. Gray until hovered. Pauses on hover. */
export default function BrandMarquee() {
  const loop = [...BRAND_LOGOS, ...BRAND_LOGOS];
  return (
    <section aria-label="الماركات" className="marquee card overflow-hidden py-5" dir="ltr">
      <div className="marquee-track flex w-max items-center gap-12 px-6" aria-hidden="true">
        {loop.map((b, i) => (
          <Image
            key={`${b.name}-${i}`}
            src={b.src}
            alt=""
            width={120}
            height={40}
            unoptimized
            className="h-8 w-auto shrink-0 opacity-60 grayscale transition duration-300 hover:opacity-100 hover:grayscale-0 sm:h-9"
          />
        ))}
      </div>
      <p className="sr-only">الماركات المتوفرة: {BRAND_LOGOS.map((b) => b.name).join("، ")}</p>
    </section>
  );
}
