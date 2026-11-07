"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Moves its children vertically at a different speed than the page while on screen.
 * speed 0.1 = subtle, negative = moves the other way. Disabled for reduced motion.
 */
export default function Parallax({
  children,
  speed = 0.12,
  className = "",
}: {
  children: ReactNode;
  speed?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Measure the untransformed parent so our own movement never feeds back into the maths.
    const anchor = el.parentElement ?? el;
    let raf = 0;
    let visible = true;

    const update = () => {
      raf = 0;
      const r = anchor.getBoundingClientRect();
      const raw = (r.top + r.height / 2 - window.innerHeight / 2) * speed;
      const offset = Math.max(-80, Math.min(80, raw));
      el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    };
    const onScroll = () => {
      if (visible && !raf) raf = requestAnimationFrame(update);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) update();
    });
    io.observe(anchor);
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed]);

  return (
    <div ref={ref} className={`will-change-transform ${className}`}>
      {children}
    </div>
  );
}
