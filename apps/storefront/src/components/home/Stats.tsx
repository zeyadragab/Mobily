import CountUp from "../motion/CountUp";
import Reveal from "../motion/Reveal";

const ICONS: Record<string, string> = {
  "منتج متاح": "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  "قسم": "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  "ماركة": "M20 12l-8 8-9-9V4h7zM7.5 7.5h.01",
  "ساعة حجز مجاني": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
};

/** Numbers come from the real catalog, never invented. One dark band, four cells split by hairlines. */
export default function Stats({ stats }: { stats: { label: string; value: number; suffix?: string }[] }) {
  const shown = stats.filter((s) => s.value > 0);
  if (shown.length === 0) return null;
  return (
    <section aria-label="أرقامنا">
      <Reveal>
        <ul className="relative isolate grid grid-cols-2 overflow-hidden rounded-3xl bg-linear-to-br from-blue-700 via-blue-900 to-slate-950 text-white shadow-xl lg:grid-cols-4">
          <span aria-hidden="true" className="pointer-events-none absolute -start-24 -top-24 -z-10 size-72 rounded-full bg-blue-400/25 blur-3xl" />
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 -end-16 -z-10 size-64 rounded-full bg-sky-300/15 blur-3xl" />
          {shown.map((s, i) => (
            <li
              key={s.label}
              className={`flex flex-col items-center gap-2 px-4 py-7 text-center sm:py-9 ${
                i % 2 === 1 ? "border-s border-white/10" : ""
              } ${i >= 2 ? "border-t border-white/10 lg:border-t-0" : ""} ${i > 0 ? "lg:border-s lg:border-white/10" : ""}`}
            >
              <span
                aria-hidden="true"
                className="flex size-11 items-center justify-center rounded-full bg-white/10 text-sky-200 ring-1 ring-white/15"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-5">
                  <path d={ICONS[s.label] ?? ICONS["قسم"]} />
                </svg>
              </span>
              <p className="text-4xl font-extrabold tabular-nums tracking-tight sm:text-5xl">
                <CountUp value={s.value} suffix={s.suffix} />
              </p>
              <p className="text-sm font-medium text-blue-100/80">{s.label}</p>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}
