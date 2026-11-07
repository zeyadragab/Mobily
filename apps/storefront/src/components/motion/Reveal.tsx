"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Fades and lifts its children in when they scroll into view.
 * - Server HTML is visible (no-JS and crawlers see everything).
 * - Items already on screen at load are left alone (the hero has its own entrance).
 * - `delay` staggers siblings (1 step = 90ms). Respects prefers-reduced-motion via CSS.
 */
export default function Reveal({
  children,
  delay = 0,
  y = 28,
  scale = 1,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  scale?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;

    el.dataset.reveal = "hidden";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.dataset.reveal = "shown";
        io.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const style = { "--delay": delay, "--y": `${y}px`, "--s": scale } as CSSProperties;
  return (
    <div ref={ref} style={style} className={className}>
      {children}
    </div>
  );
}
