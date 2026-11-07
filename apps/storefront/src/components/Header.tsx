"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useCart } from "@/lib/cart";

const NAME = process.env.NEXT_PUBLIC_STORE_NAME || "متجر الموبايلات";

const I = {
  menu: "M4 6h16M4 12h16M4 18h10",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  cart: "M6 6h15l-2 9H8zM6 6L5 3H2M9 20a1 1 0 1 0 0-.01M18 20a1 1 0 1 0 0-.01",
  close: "M6 6l12 12M18 6L6 18",
};
export function Ico({ d, className = "h-6 w-6" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export default function Header({ categories }: { categories: { id: string; name: string }[] }) {
  const { count } = useCart();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  function search(e: FormEvent) {
    e.preventDefault();
    const s = q.trim();
    setSearchOpen(false);
    router.push(s ? `/products?q=${encodeURIComponent(s)}` : "/products");
  }

  const searchBox = (
    <input
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="ابحث عن موبايل أو لابتوب أو إكسسوار"
      aria-label="بحث"
      className="w-full rounded-full border border-line bg-bg px-5 py-2.5 text-sm outline-none focus:border-accent"
    />
  );

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3">
        <button
          aria-label="القائمة"
          aria-expanded={drawer}
          onClick={() => setDrawer(true)}
          className="rounded-full p-2 hover:bg-bg md:hidden"
        >
          <Ico d={I.menu} />
        </button>
        <button
          aria-label="بحث"
          aria-expanded={searchOpen}
          onClick={() => setSearchOpen((v) => !v)}
          className="rounded-full p-2 hover:bg-bg md:hidden"
        >
          <Ico d={I.search} />
        </button>

        <Link href="/" className="mx-auto text-xl font-extrabold tracking-tight text-accent md:mx-0">
          {NAME}
        </Link>

        <form onSubmit={search} role="search" className="mx-6 hidden max-w-xl flex-1 md:block">
          {searchBox}
        </form>

        <nav className="hidden items-center gap-1 text-sm font-medium md:flex" aria-label="التنقل الرئيسي">
          <Link href="/products" className="rounded-full px-4 py-2 hover:bg-bg">المنتجات</Link>
          <Link href="/track" className="rounded-full px-4 py-2 hover:bg-bg">تتبع طلبي</Link>
        </nav>

        <Link href="/cart" className="relative rounded-full p-2 hover:bg-bg" aria-label={`السلة، ${count} عنصر`}>
          <Ico d={I.cart} />
          {count > 0 && (
            <span className="absolute -top-0.5 -end-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-white">
              {count}
            </span>
          )}
        </Link>
      </div>

      {searchOpen && (
        <form onSubmit={search} role="search" className="px-4 pb-3 md:hidden">
          {searchBox}
        </form>
      )}

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="الأقسام">
          <button aria-label="إغلاق" className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 start-0 flex w-72 max-w-[85%] flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-4">
              <span className="text-lg font-bold">{NAME}</span>
              <button aria-label="إغلاق" onClick={() => setDrawer(false)} className="rounded-full p-2 hover:bg-bg">
                <Ico d={I.close} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3" aria-label="الأقسام">
              {[{ href: "/products", label: "كل المنتجات" }, ...categories.map((c) => ({ href: `/products?category=${c.id}`, label: c.name })), { href: "/track", label: "تتبع طلبي" }].map((l) => (
                <Link key={l.href} href={l.href} onClick={() => setDrawer(false)} className="block rounded-xl px-4 py-3 font-medium hover:bg-bg">
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
