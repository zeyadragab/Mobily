"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export default function ProductRail({ children }: { children: ReactNode }) {
  const id = useId();
  const rail = useRef<HTMLUListElement>(null);
  const [bounds, setBounds] = useState({ previous: false, next: false });

  useEffect(() => {
    const row = rail.current;
    if (!row) return;

    function update() {
      if (!row) return;
      const offset = Math.abs(row.scrollLeft);
      const previous = offset > 2;
      const next = row.scrollWidth - row.clientWidth - offset > 2;
      setBounds((current) => current.previous === previous && current.next === next ? current : { previous, next });
    }

    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    row.addEventListener("scroll", update, { passive: true });
    return () => {
      row.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [children]);

  function scroll(direction: number) {
    if (!(direction > 0 ? bounds.previous : bounds.next)) return;
    const row = rail.current;
    if (row) row.scrollBy({ left: direction * row.clientWidth * 0.8 });
  }

  return (
    <div className="relative">
      <ul id={id} ref={rail} className="shop-rail flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-4 pt-1 sm:gap-4">
        {children}
      </ul>
      {(bounds.previous || bounds.next) && (
        <>
          <button type="button" aria-controls={id} aria-label="المنتجات السابقة" aria-disabled={!bounds.previous} onClick={() => scroll(1)} className="shop-icon-button absolute start-2 top-1/2 z-10 -translate-y-1/2 shadow-(--shadow-card) aria-disabled:opacity-50">→</button>
          <button type="button" aria-controls={id} aria-label="المنتجات التالية" aria-disabled={!bounds.next} onClick={() => scroll(-1)} className="shop-icon-button absolute end-2 top-1/2 z-10 -translate-y-1/2 shadow-(--shadow-card) aria-disabled:opacity-50">←</button>
        </>
      )}
    </div>
  );
}
