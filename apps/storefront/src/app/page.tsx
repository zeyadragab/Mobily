import { fetchCategories, fetchItems, groupProducts, safe } from "@/lib/catalog";
import { ProductRow } from "@/components/ProductGrid";
import Hero from "@/components/Hero";
import BrandMarquee from "@/components/home/BrandMarquee";
import CategoryBento from "@/components/home/CategoryBento";
import HowItWorks from "@/components/home/HowItWorks";
import Stats from "@/components/home/Stats";
import FinalCta from "@/components/home/FinalCta";
import PromoBanners from "@/components/home/PromoBanners";
import PhonesShowcase from "@/components/home/PhonesShowcase";
import Reveal from "@/components/motion/Reveal";

export const revalidate = 60;

export default async function Home() {
  const [c, i] = await Promise.all([safe(fetchCategories(), []), safe(fetchItems(), [])]);
  const cats = c.data;
  const error = c.failed || i.failed;
  const all = groupProducts(i.data);
  const latest = all.slice(0, 12);
  const mobileCat = cats.find((x) => /موبايل|mobile|phone/i.test(x.name));
  const brands = [...new Set(all.map((p) => p.brand).filter((b): b is string => !!b))];

  return (
    <div className="space-y-12 sm:space-y-16">
      <Hero />
      <BrandMarquee />
      <PromoBanners />
      <CategoryBento cats={cats} />
      <PhonesShowcase mobileHref={mobileCat ? `/products?category=${mobileCat.id}` : "/products"} />

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

      <Reveal>
        <ProductRow title="وصل حديثًا" href="/products" products={latest} />
      </Reveal>

      <HowItWorks />

      {cats.slice(0, 3).map((cat) => (
        <Reveal key={cat.id}>
          <ProductRow
            title={cat.name}
            href={`/products?category=${cat.id}`}
            products={all.filter((p) => p.category_id === cat.id).slice(0, 12)}
          />
        </Reveal>
      ))}

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
