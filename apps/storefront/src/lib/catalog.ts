import { supabase } from "./supabase";

export type Item = {
  variant_id: string;
  product_id: string;
  name: string;
  brand: string | null;
  description: string | null;
  image_url: string | null;
  category_id: string | null;
  category: string | null;
  color: string | null;
  storage: string | null;
  condition: "new" | "used" | "refurbished";
  price: string;
  available: number;
};

export type ProductCard = {
  id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  category_id: string | null;
  category: string | null;
  minPrice: number;
  maxPrice: number;
  inStock: boolean;
};

export const CONDITION_AR = { new: "جديد", used: "مستعمل", refurbished: "مجدد" } as const;

const COLS =
  "variant_id,product_id,name,brand,description,image_url,category_id,category,color,storage,condition,price,available";

export async function fetchItems(opts: { category?: string; q?: string } = {}): Promise<Item[]> {
  let query = supabase.from("catalog_items").select(COLS).order("name");
  if (opts.category) query = query.eq("category_id", opts.category);
  if (opts.q) {
    const s = opts.q.replace(/[%,()]/g, " ").trim();
    if (s) query = query.or(`name.ilike.%${s}%,brand.ilike.%${s}%`);
  }
  const { data, error } = await query.limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as Item[];
}

export async function fetchProduct(id: string): Promise<Item[]> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return [];
  const { data, error } = await supabase.from("catalog_items").select(COLS).eq("product_id", id);
  if (error) throw new Error(error.message);
  return (data ?? []) as Item[];
}

export async function fetchCategories(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from("catalog_items").select("category_id,category");
  if (error) throw new Error(error.message);
  const m = new Map<string, string>();
  for (const r of (data ?? []) as { category_id: string | null; category: string | null }[]) {
    if (r.category_id && r.category) m.set(r.category_id, r.category);
  }
  return [...m].map(([id, name]) => ({ id, name }));
}

export function groupProducts(items: Item[]): ProductCard[] {
  const m = new Map<string, ProductCard>();
  for (const i of items) {
    const price = Number(i.price);
    const c = m.get(i.product_id);
    if (!c) {
      m.set(i.product_id, {
        id: i.product_id, name: i.name, brand: i.brand, image_url: i.image_url,
        category_id: i.category_id, category: i.category,
        minPrice: price, maxPrice: price, inStock: i.available > 0,
      });
    } else {
      c.minPrice = Math.min(c.minPrice, price);
      c.maxPrice = Math.max(c.maxPrice, price);
      c.inStock = c.inStock || i.available > 0;
    }
  }
  return [...m.values()];
}

/** Await a query without throwing: pages show a friendly message when `failed` is true. */
export async function safe<T>(p: Promise<T>, fallback: T): Promise<{ data: T; failed: boolean }> {
  try {
    return { data: await p, failed: false };
  } catch {
    return { data: fallback, failed: true };
  }
}

export function egp(n: number | string) {
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(Number(n));
}

export function variantTitle(i: Pick<Item, "storage" | "color" | "condition">) {
  return [i.storage, i.color, i.condition !== "new" ? CONDITION_AR[i.condition] : null].filter(Boolean).join(" / ") || "الإصدار الأساسي";
}
