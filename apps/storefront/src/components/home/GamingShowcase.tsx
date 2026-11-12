import { groupProducts, variantTitle, type Item } from "@/lib/catalog";
import GamingShelf from "./GamingShelf";

const GROUPS = [
  { name: "أجهزة الألعاب", image: "neon-scout.png", match: /playstation|xbox|nintendo|بلاي\s?ستيشن|إكس بوكس|نينتندو/i },
  { name: "أذرع التحكم", image: "frost-tech.png", match: /gamepad|controller|dualsense|joystick|ذراع|دراع|يد تحكم|دواسة|مقود/i },
  { name: "أسطوانات الألعاب", image: "arcade-mage.png", match: /games?\s?(disc|cd)|أسطوان|اسطوان|أقراص|ألعاب بلاي/i },
  { name: "إكسسوارات الجيمنج", image: "street-champion.png", match: /headset|headphone|mouse|keyboard|cooling|virtual reality|accessor|سماعات?|كيبورد|ماوس|حامل|ستاند|نظارة|إكسسوار/i },
];

function findGroup(item: Item) {
  const name = item.name;
  for (const index of [2, 3, 1, 0]) {
    if (GROUPS[index].match.test(name)) return index;
  }
  return GROUPS[3].match.test(item.category ?? "") && /جيمنج|gaming/i.test(item.category ?? "") ? 3 : -1;
}

export default function GamingShowcase({ items }: { items: Item[] }) {
  const groups = GROUPS.map((group, index) => {
    const variants = items.filter((item) => findGroup(item) === index);
    return {
      name: group.name,
      image: `/img/gaming-alternatives/${group.image}`,
      products: groupProducts(variants).slice(0, 16).map((product) => {
        const options = variants.filter((item) => item.product_id === product.id);
        const option = options.length === 1 ? options[0] : undefined;
        return {
          ...product,
          quickAdd: option && option.available > 0 ? {
            variant_id: option.variant_id, product_id: option.product_id, name: option.name,
            variant: variantTitle(option), price: Number(option.price), available: option.available, image_url: option.image_url,
          } : undefined,
        };
      }),
    };
  });

  return <GamingShelf groups={groups} />;
}
