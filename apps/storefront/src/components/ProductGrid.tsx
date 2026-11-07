import Image from "next/image";
import Link from "next/link";
import { egp, type ProductCard as Card } from "@/lib/catalog";

export function Thumb({ name, src, className = "" }: { name: string; src: string | null; className?: string }) {
  return (
    <div className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-bg ${className}`}>
      {src ? (
        <Image src={src} alt={name} fill sizes="(max-width: 640px) 50vw, 25vw" className="object-contain p-4" unoptimized={src.endsWith(".svg")} />
      ) : (
        <span aria-hidden="true" className="text-5xl font-bold text-muted/40">
          {name.trim().charAt(0)}
        </span>
      )}
    </div>
  );
}

export function ProductCard({ p }: { p: Card }) {
  return (
    <Link
      href={`/products/${p.id}`}
      className="group flex h-full flex-col gap-3 rounded-3xl border border-line bg-surface p-3 shadow-(--shadow-card) transition hover:-translate-y-0.5 hover:border-accent"
    >
      <Thumb name={p.name} src={p.image_url} />
      <div className="flex flex-1 flex-col gap-1.5 px-1">
        {p.brand && <span className="text-xs text-muted">{p.brand}</span>}
        <h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-5" dir="auto">
          {p.name}
        </h3>
        <p className="pt-1 text-lg font-bold">
          {p.minPrice !== p.maxPrice && <span className="me-1 text-xs font-medium text-muted">من</span>}
          {egp(p.minPrice)}
        </p>
        <span
          className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${
            p.inStock ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"
          }`}
        >
          {p.inStock ? "متوفر" : "غير متوفر حاليًا"}
        </span>
      </div>
      <span
        className={`rounded-full py-2.5 text-center text-sm font-semibold ${
          p.inStock ? "bg-(image:--brand-gradient) text-white" : "bg-bg text-muted"
        }`}
      >
        {p.inStock ? "احجز الآن" : "التفاصيل"}
      </span>
    </Link>
  );
}

export function ProductGrid({ products }: { products: Card[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
      {products.map((p) => (
        <li key={p.id}>
          <ProductCard p={p} />
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
        <h2 className="text-xl font-bold sm:text-2xl">{title}</h2>
        <Link href={href} className="text-sm font-medium text-accent hover:underline">
          عرض الكل
        </Link>
      </div>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:gap-4 [&::-webkit-scrollbar]:hidden">
        {products.map((p) => (
          <li key={p.id} className="w-44 shrink-0 snap-start sm:w-56">
            <ProductCard p={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}
