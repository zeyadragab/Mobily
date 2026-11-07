import Link from "next/link";
import { fetchCategories, fetchItems, groupProducts, safe } from "@/lib/catalog";
import { ProductRow } from "@/components/ProductGrid";
import Hero from "@/components/Hero";

export const revalidate = 60;

const USPS = [
  { t: "حجز مجاني", d: "نحجز لك القطعة 24 ساعة" },
  { t: "استلام أو توصيل", d: "من المحل أو لحد بابك" },
  { t: "أسعار واضحة", d: "السعر والتوافر لحظة بلحظة" },
  { t: "ضمان وخدمة", d: "ضمان على الأجهزة الجديدة" },
];

export default async function Home() {
  const [c, i] = await Promise.all([safe(fetchCategories(), []), safe(fetchItems(), [])]);
  const cats = c.data;
  const error = c.failed || i.failed;
  const all = groupProducts(i.data);
  const latest = all.slice(0, 12);

  return (
    <div className="space-y-8 sm:space-y-10">
      <Hero />

      {cats.length > 0 && (
        <nav aria-label="الأقسام">
          <ul className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:justify-center [&::-webkit-scrollbar]:hidden">
            {cats.map((cat) => (
              <li key={cat.id} className="shrink-0">
                <Link href={`/products?category=${cat.id}`} className="group flex w-20 flex-col items-center gap-2 text-center sm:w-24">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full border border-line bg-surface text-2xl font-bold text-accent shadow-(--shadow-card) transition group-hover:border-accent sm:h-20 sm:w-20">
                    {cat.name.trim().charAt(0)}
                  </span>
                  <span className="text-xs font-medium sm:text-sm">{cat.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {error && (
        <p role="alert" className="rounded-2xl border border-line bg-surface p-6 text-center text-muted">
          تعذّر تحميل المنتجات الآن. حاول مرة أخرى بعد قليل.
        </p>
      )}
      {!error && all.length === 0 && (
        <p className="rounded-2xl border border-line bg-surface p-6 text-center text-muted">
          لا توجد منتجات منشورة بعد. سنضيفها قريبًا.
        </p>
      )}

      <ProductRow title="وصل حديثًا" href="/products" products={latest} />

      {cats.slice(0, 4).map((cat) => (
        <ProductRow
          key={cat.id}
          title={cat.name}
          href={`/products?category=${cat.id}`}
          products={all.filter((p) => p.category_id === cat.id).slice(0, 12)}
        />
      ))}

      <section aria-label="مميزاتنا">
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {USPS.map((u) => (
            <li key={u.t} className="rounded-3xl border border-line bg-surface p-4 shadow-(--shadow-card)">
              <p className="font-bold text-accent">{u.t}</p>
              <p className="mt-1 text-sm text-muted">{u.d}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
