import Image from "next/image";
import Link from "next/link";
import { egp, type ProductCard as Card } from "@/lib/catalog";
import { PHONE_PLACEHOLDER, PRODUCT_IMAGES } from "@/lib/site-images";
import Reveal from "./motion/Reveal";
import ProductRail from "./ProductRail";

export function Thumb({ name, src, className = "" }: { name: string; src: string | null; className?: string }) {
  const phonePlaceholder = src === PHONE_PLACEHOLDER;
  return (
    <div className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-white ${className}`}>
      {src ? (
        <Image
          src={src}
          alt={phonePlaceholder ? "" : name}
          fill
          sizes="(max-width: 640px) 50vw, 25vw"
          className={phonePlaceholder ? "object-contain p-6 opacity-75" : "object-contain p-4 transition-transform duration-500 ease-out group-hover:scale-110"}
          unoptimized={src.endsWith(".svg")}
        />
      ) : (
        <span aria-hidden="true" className="text-5xl font-bold text-muted/40">
          {name.trim().charAt(0)}
        </span>
      )}
    </div>
  );
}

export function ProductCard({ p }: { p: Card }) {
  const illustrative = p.image_url === PRODUCT_IMAGES[p.id] || p.image_url?.startsWith("/demo/");
  return (
    <Link
      href={`/products/${p.id}`}
      className="card group flex h-full flex-col gap-3 p-2.5 transition duration-300 hover:-translate-y-1 hover:border-accent hover:shadow-xl sm:p-3"
    >
      <div className="relative">
        <Thumb name={p.name} src={p.image_url} />
        <span
          className={`absolute start-2 top-2 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-semibold ${
            p.inStock ? "text-ok" : "text-danger"
          }`}
        >
          {p.inStock ? "متوفر" : "غير متوفر"}
        </span>
        {illustrative && <span className="absolute end-2 bottom-2 rounded-full bg-surface px-2 py-0.5 text-[0.65rem] text-muted">{p.image_url === PHONE_PLACEHOLDER ? "الصورة غير متاحة" : "صورة استرشادية"}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-1">
        {p.brand && <span className="text-xs font-medium text-muted">{p.brand}</span>}
        <h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-5" dir="auto">
          {p.name}
        </h3>
        <p className="pt-1 text-lg font-extrabold">
          {p.minPrice !== p.maxPrice && <span className="me-1 text-xs font-medium text-muted">من</span>}
          <bdi>{egp(p.minPrice)}</bdi>
        </p>
      </div>
      <span
        className="flex items-center justify-between gap-1 rounded-full bg-bg px-3 py-2.5 text-sm font-semibold text-accent transition-colors group-hover:bg-accent group-hover:text-accent-fg"
      >
        {p.inStock ? "عرض المنتج" : "التفاصيل"}
        <span aria-hidden="true" className="transition-transform group-hover:-translate-x-1">←</span>
      </span>
    </Link>
  );
}

export function ProductGrid({ products }: { products: Card[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
      {products.map((p, i) => (
        <li key={p.id}>
          <Reveal delay={i % 4} y={20} className="h-full">
            <ProductCard p={p} />
          </Reveal>
        </li>
      ))}
    </ul>
  );
}

/** Horizontal, swipeable row of product cards with a section title (scroll-snap, works in RTL). */
export function ProductRow({
  title,
  href,
  products,
}: {
  title: string;
  href: string;
  products: Card[];
}) {
  if (products.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex items-end justify-between">
        <h2 className="text-2xl font-extrabold sm:text-3xl">{title}</h2>
        <Link href={href} className="text-sm font-semibold text-accent hover:underline">
          عرض الكل ←
        </Link>
      </div>
      <ProductRail>
        {products.map((p) => (
          <li key={p.id} className="w-44 shrink-0 snap-start sm:w-56">
            <ProductCard p={p} />
          </li>
        ))}
      </ProductRail>
    </section>
  );
}
