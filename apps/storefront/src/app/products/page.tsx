import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { fetchCategories, fetchItems, groupProducts, safe } from "@/lib/catalog";
import { ProductGrid } from "@/components/ProductGrid";
import { BRAND_LOGOS, categoryImage, isMobileCategory } from "@/lib/site-images";

export const metadata: Metadata = { title: "المنتجات" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string; brand?: string }>;
}) {
  const { category, q, brand } = await searchParams;
  const cat = typeof category === "string" && /^[0-9a-f-]{36}$/i.test(category) ? category : undefined;
  const query = typeof q === "string" ? q.slice(0, 60).trim() : undefined;

  const [c, i] = await Promise.all([safe(fetchCategories(), []), safe(fetchItems({ category: cat, q: query }), [])]);
  const cats = c.data;
  const items = i.data;
  const error = c.failed || i.failed;
  const catalog = groupProducts(items);
  const activeName = cats.find((x) => x.id === cat)?.name;
  const banner = activeName ? categoryImage(activeName) : null;
  const mobile = isMobileCategory(activeName);
  const brands = mobile ? [...new Set(catalog.flatMap((product) => product.brand ? [product.brand] : []))].sort() : [];
  const activeBrand = typeof brand === "string" ? brands.find((name) => name.toLowerCase() === brand.trim().toLowerCase()) : undefined;
  const products = activeBrand ? catalog.filter((product) => product.brand === activeBrand) : catalog;

  function categoryHref(id?: string, brandName?: string) {
    const params = new URLSearchParams();
    if (id) params.set("category", id);
    if (query) params.set("q", query);
    if (brandName) params.set("brand", brandName);
    const search = params.toString();
    return search ? `/products?${search}` : "/products";
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <nav aria-label="مسار التنقل" className="flex items-center gap-2 text-sm text-muted">
        <Link href="/" className="hover:text-accent">الرئيسية</Link>
        <span aria-hidden="true">/</span>
        <Link href="/products" aria-current={activeName || query ? undefined : "page"} className="hover:text-accent">الكتالوج</Link>
        {activeName && <><span aria-hidden="true">/</span><span>{activeName}</span></>}
      </nav>
      <header className="relative isolate flex min-h-44 items-center overflow-hidden rounded-[2rem] bg-slate-950 px-5 py-7 text-white sm:min-h-58 sm:px-10">
        {banner && <Image src={banner} alt="" fill sizes="(max-width: 768px) 95vw, 90vw" className="-z-20 object-cover object-[15%_center]" />}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-l from-slate-950 via-slate-950/85 to-blue-950/40" />
        <div className="rise min-w-0 space-y-2">
          <p className="text-sm font-bold text-blue-200">كتالوج المتجر</p>
          <h1 className="wrap-break-word text-3xl font-extrabold sm:text-4xl lg:text-5xl">
            {query ? <>نتائج البحث عن <bdi>{query}</bdi></> : (activeName ?? "كل المنتجات")}
          </h1>
          {!error && <p className="text-sm text-white/85">{products.length} منتج</p>}
        </div>
      </header>

      <nav aria-label="الأقسام" className="rounded-2xl border border-line bg-surface p-2">
        <ul className="shop-rail flex gap-2 overflow-x-auto p-1">
          <li>
            <Link href={categoryHref()} className="chip block" aria-current={!activeName ? "true" : undefined}>
              الكل
            </Link>
          </li>
          {cats.map((x) => (
            <li key={x.id}>
              <Link href={categoryHref(x.id)} className="chip block" aria-current={cat === x.id ? "true" : undefined}>
                {x.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {brands.length > 0 && (
        <nav id="mobile-brands" aria-label="ماركات الموبايلات">
          <ul className="shop-rail flex gap-2 overflow-x-auto px-1 py-2">
            <li>
              <Link href={categoryHref(cat)} className="chip flex h-11 items-center" aria-current={!activeBrand ? "true" : undefined}>كل الماركات</Link>
            </li>
            {brands.map((name) => {
              const logo = BRAND_LOGOS.find((item) => item.name.toLowerCase() === name.toLowerCase());
              return (
                <li key={name}>
                  <Link href={categoryHref(cat, name)} className="chip flex h-11 items-center gap-2" aria-current={activeBrand === name ? "true" : undefined}>
                    {logo && <Image src={logo.src} alt="" width={30} height={18} unoptimized className="h-[18px] w-[30px] rounded-sm bg-white object-contain p-0.5" />}
                    <bdi>{name}</bdi>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

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
