import CountUp from "../motion/CountUp";
import Reveal from "../motion/Reveal";

const ICONS: Record<string, string> = {
  "منتج متاح": "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  "قسم": "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  "ماركة": "M20 12l-8 8-9-9V4h7zM7.5 7.5h.01",
  "ساعة حجز مجاني": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
};

/** Numbers come from the real catalog, never invented. The first tile is the highlighted one. */
export default function Stats({ stats }: { stats: { label: string; value: number; suffix?: string }[] }) {
  const shown = stats.filter((s) => s.value > 0);
  if (shown.length === 0) return null;
  return (
    <section aria-label="أرقامنا">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {shown.map((s, i) => {
          const hero = i === 0;
          return (
            <li key={s.label}>
              <Reveal delay={i} className="h-full">
                <div
                  className={`group relative h-full overflow-hidden rounded-3xl p-5 transition duration-300 hover:-translate-y-1 hover:shadow-xl sm:p-6 ${
                    hero ? "bg-linear-to-br from-blue-700 to-slate-950 text-white shadow-lg" : "card"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute -end-8 -top-8 h-28 w-28 rounded-full transition-transform duration-500 group-hover:scale-125 ${
                      hero ? "bg-white/10" : "bg-accent/10"
                    }`}
                  />
                  <span
                    aria-hidden="true"
                    className={`relative flex h-11 w-11 items-center justify-center rounded-2xl ${
                      hero ? "bg-white/15" : "bg-(image:--brand-gradient) text-white"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                      <path d={ICONS[s.label] ?? ICONS["قسم"]} />
                    </svg>
                  </span>
                  <p className={`relative mt-4 text-4xl font-extrabold tabular-nums sm:text-5xl ${hero ? "" : "bg-(image:--brand-gradient) bg-clip-text text-transparent"}`}>
                    <CountUp value={s.value} suffix={s.suffix} />
                  </p>
                  <p className={`relative mt-1 text-sm font-medium ${hero ? "text-white/80" : "text-muted"}`}>{s.label}</p>
                </div>
              </Reveal>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
