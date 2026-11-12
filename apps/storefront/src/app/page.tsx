import { fetchCategories, fetchItems, groupProducts, safe } from "@/lib/catalog";
import { ProductRow } from "@/components/ProductGrid";
import Hero from "@/components/Hero";
import BrandMarquee from "@/components/home/BrandMarquee";
import CategoryShortcuts from "@/components/home/CategoryBento";
import HowItWorks from "@/components/home/HowItWorks";
import Stats from "@/components/home/Stats";
import FinalCta from "@/components/home/FinalCta";
import PromoBanners from "@/components/home/PromoBanners";
import Reveal from "@/components/motion/Reveal";
import FeaturedCollections from "@/components/home/FeaturedCollections";
import GamingShowcase from "@/components/home/GamingShowcase";
import { isMobileCategory } from "@/lib/site-images";

export const revalidate = 60;

export default async function Home() {
  const [c, i] = await Promise.all([safe(fetchCategories(), []), safe(fetchItems(), [])]);
  const cats = c.data;
  const error = c.failed || i.failed;
  const all = groupProducts(i.data);
  const highlights = all.filter((product) => product.inStock).slice(0, 8);
  const mobileCat = cats.find((x) => isMobileCategory(x.name));
  const computerCat = cats.find((x) => /لاب|laptop|كمبيوتر/i.test(x.name));
  const mobiles = mobileCat ? all.filter((product) => product.category_id === mobileCat.id).slice(0, 10) : [];
  const computers = computerCat ? all.filter((product) => product.category_id === computerCat.id).slice(0, 10) : [];
  const brands = [...new Set(all.map((p) => p.brand).filter((b): b is string => !!b))];

  return (
    <div className="space-y-12 sm:space-y-16">
      <div className="space-y-3 sm:space-y-4">
        <Hero />
        <CategoryShortcuts cats={cats} />
      </div>

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

      <ProductRow title="مختارات المتجر" href="/products" products={highlights.length ? highlights : all.slice(0, 8)} />
      <PromoBanners />
      {mobileCat && <ProductRow title={mobileCat.name} href={`/products?category=${mobileCat.id}`} products={mobiles} />}
      <div className="space-y-4 sm:space-y-5">
        <FeaturedCollections categories={cats} />
        {computerCat && <ProductRow title="تسوّق اللابتوبات" href={`/products?category=${computerCat.id}`} products={computers} />}
      </div>
      <GamingShowcase items={i.data} />

      {cats.filter((cat) => cat.id !== mobileCat?.id && cat.id !== computerCat?.id).slice(0, 2).map((cat) => (
        <Reveal key={cat.id}>
          <ProductRow
            title={cat.name}
            href={`/products?category=${cat.id}`}
            products={all.filter((p) => p.category_id === cat.id).slice(0, 12)}
          />
        </Reveal>
      ))}

      <HowItWorks />
      <BrandMarquee />

      <Stats
        stats={[
          { label: "منتج متاح", value: all.length },
          { label: "قسم", value: cats.length },
          { label: "ماركة", value: brands.length },
          { label: "ساعة حجز مجاني", value: 24 },
        ]}
      />

      <FinalCta />
    </div>
  );
}
