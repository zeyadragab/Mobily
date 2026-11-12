"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/lib/cart";
import { useOpenCart } from "./CartDrawer";
import { Ico } from "./Header";

const ICONS = {
  home: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  track: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  cart: "M6 6h15l-2 9H8zM6 6L5 3H2M9 20a1 1 0 1 0 0-.01M18 20a1 1 0 1 0 0-.01",
};

/** Phone-only bottom navigation with a raised center action. */
export default function TabBar() {
  const path = usePathname();
  const { count } = useCart();
  const openCart = useOpenCart();
  const item = (href: string, label: string, icon: keyof typeof ICONS) => {
    const active = href === "/" ? path === "/" : path.startsWith(href);
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${active ? "font-semibold text-accent" : "text-muted"}`}
      >
        <Ico d={ICONS[icon]} className="h-6 w-6" />
        {label}
      </Link>
    );
  };

  return (
    <nav aria-label="التنقل السريع" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="mx-auto flex max-w-md items-end">
        {item("/", "الرئيسية", "home")}
        {item("/products", "الأقسام", "grid")}
        <Link href="/products" aria-label="أحدث المنتجات" className="-mt-6 flex flex-1 flex-col items-center gap-0.5 text-xs font-semibold text-accent">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-surface bg-(image:--brand-gradient) text-white shadow-lg">
            <Ico d={ICONS.bolt} className="h-6 w-6" />
          </span>
          جديدنا
        </Link>
        {item("/track", "طلباتي", "track")}
        <button
          type="button"
          aria-label={`السلة، ${count} عنصر`}
          aria-haspopup="dialog"
          aria-controls="cart-drawer"
          className="relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-muted"
          onClick={() => openCart()}
        >
          <Ico d={ICONS.cart} />
          السلة
          {count > 0 && (
            <span className="absolute end-1/4 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-fg">
              {count}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
