import Image from "next/image";
import Link from "next/link";
import { categoryImage } from "@/lib/site-images";

const GRID = "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z";
const OFFERS = "M3 12V4h8l10 10-7 7zM7.5 8h.01";
const GAMEPAD = "M7 8h10c2 0 3 1 4 4l1 4c.4 2-2 3-3 2l-3-3H8l-3 3c-1 1-3.4 0-3-2l1-4c1-3 2-4 4-4zM8 10v4m-2-2h4m7-1h.01m2 2h.01";
const HEADPHONES = "M3 15v-3a9 9 0 0 1 18 0v3M3 14h4v6H5a2 2 0 0 1-2-2zm18 0h-4v6h2a2 2 0 0 0 2-2z";
const CHARGER = "m13 2-9 12h7l-1 8 9-12h-7z";

function shortcutArtwork(name: string) {
  if (/موبايل|هاتف|mobile|phone/i.test(name)) return { image: "/img/imgi_3_mobile.jpg", path: GRID };
  if (/تابلت|ايباد|آيباد|tablet|ipad/i.test(name)) return { image: "/img/imgi_4_tablets.jpg", path: GRID };
  if (/شواحن|شاحن|charger/i.test(name)) return { image: null, path: CHARGER };
  if (/إكسسوار|اكسسوار|accessor/i.test(name)) return { image: null, path: HEADPHONES };
  return { image: categoryImage(name), path: GRID };
}

export default function CategoryShortcuts({ cats }: { cats: { id: string; name: string }[] }) {
  const shortcuts = [
    { name: "العروض", href: "#store-offers", image: null, path: OFFERS },
    ...cats.map(({ id, name }) => ({ name, href: `/products?category=${id}`, ...shortcutArtwork(name) })),
    { name: "الجيمنج", href: "#gaming", image: null, path: GAMEPAD },
    { name: "كل الأقسام", href: "/products", image: null, path: GRID },
  ];

  return (
    <nav id="category-shortcuts" aria-label="اختصارات أقسام المتجر" className="border-b border-line pb-3">
      <ul className="shop-rail flex snap-x gap-3 overflow-x-auto p-1 sm:gap-6 lg:justify-center-safe">
        {shortcuts.map(({ name, href, image, path }) => (
          <li key={href} className="w-[4.8rem] shrink-0 snap-start sm:w-24">
            <Link href={href} className="group flex flex-col items-center gap-1.5 rounded-2xl py-2 text-center text-xs font-bold transition-colors hover:text-accent sm:text-sm">
              <span className="relative grid size-12 place-items-center overflow-hidden rounded-full border border-line bg-surface text-accent transition duration-300 group-hover:-translate-y-1 group-hover:border-accent group-hover:shadow-(--shadow-card) sm:size-16">
                {image ? (
                  <Image src={image} alt="" fill sizes="64px" className="object-cover" />
                ) : (
                  <svg viewBox="0 0 24 24" className="size-5 sm:size-7" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d={path} />
                  </svg>
                )}
              </span>
              <span>{name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
