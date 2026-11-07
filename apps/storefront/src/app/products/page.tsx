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
  const activeName = cats.find((x) => x.id === cat)?.name;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-extrabold sm:text-4xl">{query ? `نتائج: ${query}` : (activeName ?? "كل المنتجات")}</h1>
        {!error && <p className="text-sm text-muted">{products.length} منتج</p>}
      </header>

      <nav aria-label="الأقسام" className="sticky top-14 z-20 -mx-4 bg-bg/90 px-4 py-2 backdrop-blur md:top-16">
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <li>
            <Link href="/products" className="chip block" aria-current={!cat && !query ? "true" : undefined}>
              الكل
            </Link>
          </li>
          {cats.map((x) => (
            <li key={x.id}>
              <Link href={`/products?category=${x.id}`} className="chip block" aria-current={cat === x.id ? "true" : undefined}>
                {x.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {error && (
        <p role="alert" className="card p-8 text-center text-muted">
          تعذّر تحميل المنتجات الآن. حاول مرة أخرى بعد قليل.
        </p>
      )}
      {!error && products.length === 0 && (
        <div className="card space-y-3 p-10 text-center">
          <p className="text-lg font-bold">لا توجد منتجات مطابقة</p>
          <p className="text-sm text-muted">جرّب كلمة أخرى أو تصفح كل المنتجات.</p>
          <Link href="/products" className="btn-primary">عرض كل المنتجات</Link>
        </div>
      )}
      {products.length > 0 && <ProductGrid products={products} />}
    </div>
  );
}
