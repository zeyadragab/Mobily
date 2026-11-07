import Image from "next/image";
import Link from "next/link";
import { SHOWCASE_PHONES } from "@/lib/site-images";
import Reveal from "../motion/Reveal";

/** Photo-first phone cards. The second photo fades in on hover. Prices live on the products page. */
export default function PhonesShowcase({ mobileHref }: { mobileHref: string }) {
  return (
    <section aria-label="أحدث الموبايلات" className="space-y-4">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-2xl font-extrabold sm:text-3xl">أحدث الموبايلات</h2>
            <p className="mt-1 text-sm text-muted">الصور استرشادية. السعر والتوافر الحاليان في صفحة المنتجات.</p>
          </div>
          <Link href={mobileHref} className="text-sm font-semibold text-accent hover:underline">
            كل الموبايلات ←
          </Link>
        </div>
      </Reveal>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:gap-4">
        {SHOWCASE_PHONES.map((p, i) => (
          <li key={p.name}>
            <Reveal delay={i % 4} y={24} className="h-full">
              <Link
                href={p.q ? `/products?q=${encodeURIComponent(p.q)}` : mobileHref}
                className="card group flex h-full flex-col overflow-hidden transition duration-300 hover:-translate-y-1 hover:border-accent hover:shadow-xl"
              >
                <div className="relative aspect-4/5 bg-white">
                  <Image
                    src={p.front}
                    alt={p.name}
                    fill
                    sizes="(max-width: 768px) 50vw, 25vw"
                    className="object-contain p-4 transition-opacity duration-500 group-hover:opacity-0"
                  />
                  <Image
                    src={p.back}
                    alt=""
                    aria-hidden="true"
                    fill
                    sizes="(max-width: 768px) 50vw, 25vw"
                    className="object-contain p-4 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 p-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted">{p.brand}</p>
                    <h3 className="truncate font-bold">{p.name}</h3>
                  </div>
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(image:--brand-gradient) text-white transition-transform group-hover:-translate-x-1">
                    ←
                  </span>
                </div>
              </Link>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}
