/**
 * Images for the home page. All files live in `public/img/`.
 * Only pictures without another shop's logos, installment offers or prices are used here.
 */
export const SITE_IMAGES = {
  /** Wide hero picture (phone on the left, dark purple background on the right). */
  hero: "/img/imgi_1217_new-z-fold.jpg",
} as const;

/** First matching keyword in the category name wins. No match = colored gradient tile. */
const CATEGORY_IMAGES: { match: RegExp; src: string }[] = [
  { match: /gaming|جيمنج|جيمينج/i, src: "/img/imgi_37_Gaming_856fb61a-5c5b-4bf9-b3d3-49f397fa6c47.jpg" },
  { match: /لاب|laptop|كمبيوتر|notebook/i, src: "/img/imgi_38_business.jpg" },
  { match: /تابلت|ايباد|آيباد|tablet|ipad/i, src: "/img/imgi_35_ipad-new.jpg" },
  { match: /موبايل|هاتف|mobile|phone/i, src: "/img/imgi_1217_new-z-fold.jpg" },
];

export function categoryImage(name: string): string | null {
  return CATEGORY_IMAGES.find((c) => c.match.test(name))?.src ?? null;
}

/** Wide promo banners (about 2.2:1). Order = order on the page. */
export const PROMO_BANNERS: { src: string; alt: string; href: string }[] = [
  { src: "/img/imgi_89_Tecno-Banner.jpg", alt: "تكنو كامون 50 ألترا", href: "/products?q=tecno" },
  { src: "/img/imgi_87_HONOR_X9e_Pro_5G_Promotional_Banner.png", alt: "هونر X9e برو 5G", href: "/products?q=honor" },
  { src: "/img/imgi_93_infinix-website.jpg", alt: "أجهزة وإكسسوارات إنفينكس", href: "/products?q=infinix" },
  { src: "/img/imgi_91_VIVO-V80-Web-Banner-ava.jpg", alt: "فيفو V80", href: "/products?q=vivo" },
  { src: "/img/imgi_94_Republic-of-Gamers.png", alt: "لابتوب إتش بي أومنيبوك", href: "/products?q=hp" },
  { src: "/img/imgi_86_X10-Lite.jpg", alt: "سماعات هونر X10 لايت", href: "/products?q=honor" },
];

/** Brand logo wall (files in public/img/brandlogo). */
export const BRAND_LOGOS: { name: string; src: string }[] = [
  { name: "Apple", src: "imgi_16_apple_3_4.png" },
  { name: "Samsung", src: "imgi_17_Samsung_3_1.png" },
  { name: "Honor", src: "imgi_18_Honor_2_4.png" },
  { name: "Oppo", src: "imgi_19_Oppo-New2_2_4.png" },
  { name: "Realme", src: "imgi_20_Realme_1_4.png" },
  { name: "Vivo", src: "imgi_21_Vivo_1_2.png" },
  { name: "Xiaomi", src: "imgi_22_Xiaomi_1.png" },
  { name: "Huawei", src: "imgi_23_Huawei_1.png" },
  { name: "Tecno", src: "imgi_24_Tecno_1_1.png" },
  { name: "Infinix", src: "imgi_25_Infinix_3_2.png" },
  { name: "Lenovo", src: "imgi_33_Lenovo_1_3.png" },
  { name: "Anker", src: "imgi_41_anker-logo_96ab76cc-9150-4dd0-be6a-3b3bc33eb049.png" },
  { name: "Oraimo", src: "imgi_43_oraimo.png" },
  { name: "JBL", src: "imgi_44_jbl.png" },
  { name: "Soundcore", src: "imgi_45_soundcore_6096a202-63c5-49f6-95b3-4531d7f6c698.png" },
  { name: "Baseus", src: "imgi_46_basues.png" },
  { name: "Amazfit", src: "imgi_48_amazfit.png" },
].map((b) => ({ ...b, src: `/img/brandlogo/${b.src}` }));

/**
 * Phones for the home page showcase (files in public/img/mobile).
 * `front` is shown first, `back` fades in on hover. No prices here: the real
 * price and stock live on the products page. `q` = search used by the card link.
 */
const M = (f: string) => `/img/mobile/${f}`;
export const SHOWCASE_PHONES: { name: string; brand: string; front: string; back: string; q?: string }[] = [
  { name: "آيفون 15", brand: "Apple", front: M("imgi_139_apple_iphone_15_6gb_ram_128gb_-_pink-1.jpg"), back: M("imgi_140_apple_iphone_15_6gb_ram_128gb_-_pink-5.jpg"), q: "Apple" },
  { name: "آيفون 16 أسود", brand: "Apple", front: M("imgi_127_iphone16-1_5919aa98-6505-4bb3-89d1-7009031dc96a.jpg"), back: M("imgi_128_iphone16-3.jpg"), q: "Apple" },
  { name: "آيفون 16 أبيض", brand: "Apple", front: M("imgi_151_2025-03-20t130704.678.jpg"), back: M("imgi_152_2025-03-20t130854.461.jpg"), q: "Apple" },
  { name: "ريدمي نوت 15 برو", brand: "Xiaomi", front: M("imgi_147_2026-01-28t180301.667.jpg"), back: M("imgi_148_2026-01-28t180315.755.jpg"), q: "Xiaomi" },
  { name: "ريدمي A7 برو 5G", brand: "Xiaomi", front: M("imgi_160_sdsdsd.jpg"), back: M("imgi_161_efwfwefef.jpg"), q: "Xiaomi" },
  { name: "إنفينكس GT 30 برو", brand: "Infinix", front: M("imgi_123_2025-08-05t182623.231.jpg"), back: M("imgi_124_2025-08-05t182640.470.jpg"), q: "Infinix" },
  { name: "فيفو Y31D", brand: "Vivo", front: M("imgi_166_2026-03-01t092822.408.jpg"), back: M("imgi_167_2026-03-17t114315.240.jpg") },
  { name: "هاتف HMD بأزرار", brand: "HMD", front: M("imgi_109_2025-06-15t103554.678.jpg"), back: M("imgi_110_2025-06-15t103452.692_0af5bba1-8b4b-407f-ac92-a1ee70eb39a9.jpg") },
];
