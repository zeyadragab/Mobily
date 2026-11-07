import type { Metadata } from "next";
import Link from "next/link";
import { fetchCategories, fetchItems, groupProducts, safe } from "@/lib/catalog";
import { ProductGrid } from "@/components/ProductGrid";

export const metadata: Metadata = { title: "المنتجات" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const { category, q } = await searchParams;
  const cat = typeof category === "string" && /^[0-9a-f-]{36}$/i.test(category) ? category : undefined;
  const query = typeof q === "string" ? q.slice(0, 60) : undefined;

  const [c, i] = await Promise.all([safe(fetchCategories(), []), safe(fetchItems({ category: cat, q: query }), [])]);
  const cats = c.data;
  const items = i.data;
  const error = c.failed || i.failed;
  const products = groupProducts(items);

  const chip = (active: boolean) =>
    `rounded-full border px-4 py-2 text-sm ${active ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface hover:border-accent"}`;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{query ? `نتائج البحث: ${query}` : "المنتجات"}</h1>
      <nav aria-label="الأقسام" className="flex flex-wrap gap-2">
        <Link href="/products" className={chip(!cat)}>
          الكل
        </Link>
        {cats.map((c) => (
          <Link key={c.id} href={`/products?category=${c.id}`} className={chip(cat === c.id)}>
            {c.name}
          </Link>
        ))}
      </nav>
      {error && (
        <p role="alert" className="rounded-xl border border-line bg-surface p-6 text-center text-muted">
          تعذّر تحميل المنتجات الآن. حاول مرة أخرى بعد قليل.
        </p>
      )}
      {!error && products.length === 0 && (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-muted">لا توجد منتجات مطابقة.</p>
      )}
      {products.length > 0 && <ProductGrid products={products} />}
    </div>
  );
}
