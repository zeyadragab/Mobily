import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { egp, fetchItems, fetchProduct, groupProducts, safe } from "@/lib/catalog";
import { ProductRow } from "@/components/ProductGrid";
import ProductMedia from "@/components/ProductMedia";
import VariantPicker from "@/components/VariantPicker";
import { PHONE_PLACEHOLDER, PRODUCT_IMAGES } from "@/lib/site-images";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const items = await fetchProduct(id).catch(() => []);
  if (!items.length) return { title: "منتج غير موجود" };
  const min = Math.min(...items.map((i) => Number(i.price)));
  return {
    title: items[0].name,
    description: `${items[0].name} بسعر يبدأ من ${egp(min)}. احجزه أونلاين واستلمه من المحل.`,
  };
}

const TRUST = [
  { t: "حجز مجاني 24 ساعة", d: "بدون دفع مقدم" },
  { t: "استلام أو توصيل", d: "من المحل أو لبابك" },
  { t: "ضمان وخدمة", d: "ضمان على الأجهزة الجديدة" },
];

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const items = await fetchProduct(id).catch(() => null);
  if (items === null) {
    return (
      <p role="alert" className="card p-8 text-center text-muted">
        تعذّر تحميل المنتج الآن. حاول مرة أخرى بعد قليل.
      </p>
    );
  }
  if (items.length === 0) notFound();
  const p = items[0];
  const allImages = [...new Set(items.map((item) => item.image_url).filter((src): src is string => Boolean(src)))];
  const productImages = allImages.length > 1 ? allImages.filter((src) => src !== PHONE_PLACEHOLDER) : allImages;
  const images = productImages.map(
    (src) => ({ src, illustrative: src === PRODUCT_IMAGES[p.product_id] || src.startsWith("/demo/") }),
  );

  const related = p.category_id
    ? groupProducts((await safe(fetchItems({ category: p.category_id }), [])).data)
        .filter((x) => x.id !== p.product_id)
        .slice(0, 12)
    : [];

  return (
    <div className="space-y-12">
      <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link href="/" className="hover:text-accent">الرئيسية</Link>
        <span aria-hidden="true">/</span>
        <Link href="/products" className="hover:text-accent">المنتجات</Link>
        {p.category && (
          <>
            <span aria-hidden="true">/</span>
            <Link href={`/products?category=${p.category_id}`} className="hover:text-accent">{p.category}</Link>
          </>
        )}
      </nav>

      <article className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:gap-10 lg:gap-14">
        <div className="md:sticky md:top-36 md:self-start">
          <ProductMedia name={p.name} images={images} />
        </div>
        <div className="space-y-6">
          <div className="rise space-y-2">
            <p className="shop-kicker">{[p.category, p.brand].filter(Boolean).join(" · ") || "تفاصيل المنتج"}</p>
            <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl lg:text-5xl" dir="auto">
              {p.name}
            </h1>
          </div>
          <VariantPicker
            items={items.map((i) => ({
              variant_id: i.variant_id, product_id: i.product_id, name: i.name, color: i.color,
              storage: i.storage, condition: i.condition, price: Number(i.price), available: i.available, image_url: i.image_url,
            }))}
          />
          <ul className="grid gap-2 sm:grid-cols-3">
            {TRUST.map((t) => (
              <li key={t.t} className="rounded-2xl border border-line bg-surface p-3 text-sm">
                <p className="font-bold">{t.t}</p>
                <p className="text-xs text-muted">{t.d}</p>
              </li>
            ))}
          </ul>
          {p.description && (
            <section className="card p-5">
              <h2 className="mb-2 font-bold">الوصف</h2>
              <p className="whitespace-pre-line text-sm leading-7 text-muted" dir="auto">
                {p.description}
              </p>
            </section>
          )}
        </div>
      </article>

      <ProductRow title="منتجات مشابهة" href={p.category_id ? `/products?category=${p.category_id}` : "/products"} products={related} />
    </div>
  );
}
