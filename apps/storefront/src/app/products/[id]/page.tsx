import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { egp, fetchProduct } from "@/lib/catalog";
import { Thumb } from "@/components/ProductGrid";
import VariantPicker from "@/components/VariantPicker";

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

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const items = await fetchProduct(id).catch(() => null);
  if (items === null) {
    return (
      <p role="alert" className="rounded-xl border border-line bg-surface p-6 text-center text-muted">
        تعذّر تحميل المنتج الآن. حاول مرة أخرى بعد قليل.
      </p>
    );
  }
  if (items.length === 0) notFound();
  const p = items[0];

  return (
    <article className="grid gap-8 md:grid-cols-2">
      <Thumb name={p.name} src={p.image_url} className="md:sticky md:top-24 md:self-start" />
      <div className="space-y-5">
        <div>
          {p.brand && <p className="text-sm text-muted">{p.brand}</p>}
          <h1 className="text-2xl font-bold" dir="auto">
            {p.name}
          </h1>
          {p.category && <p className="mt-1 text-sm text-muted">{p.category}</p>}
        </div>
        <VariantPicker
          items={items.map((i) => ({
            variant_id: i.variant_id, product_id: i.product_id, name: i.name, color: i.color,
            storage: i.storage, condition: i.condition, price: Number(i.price), available: i.available,
          }))}
        />
        {p.description && (
          <section>
            <h2 className="mb-1 font-semibold">الوصف</h2>
            <p className="whitespace-pre-line text-sm leading-7 text-muted" dir="auto">
              {p.description}
            </p>
          </section>
        )}
      </div>
    </article>
  );
}
