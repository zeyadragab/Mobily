import CountUp from "../motion/CountUp";
import Reveal from "../motion/Reveal";

/** Numbers come from the real catalog, never invented. */
export default function Stats({ stats }: { stats: { label: string; value: number; suffix?: string }[] }) {
  const shown = stats.filter((s) => s.value > 0);
  if (shown.length === 0) return null;
  return (
    <section aria-label="أرقامنا">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {shown.map((s, i) => (
          <li key={s.label}>
            <Reveal delay={i} className="h-full">
              <div className="h-full rounded-3xl border border-line bg-surface p-5 text-center shadow-(--shadow-card)">
                <p className="bg-(image:--brand-gradient) bg-clip-text text-4xl font-extrabold text-transparent sm:text-5xl">
                  <CountUp value={s.value} suffix={s.suffix} />
                </p>
                <p className="mt-1 text-sm text-muted">{s.label}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}
