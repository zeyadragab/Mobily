import Image from "next/image";
import Link from "next/link";
import { categoryImage } from "@/lib/site-images";
import Reveal from "../motion/Reveal";

const TONES = [
  "from-blue-700 to-sky-500",
  "from-slate-800 to-blue-600",
  "from-indigo-700 to-blue-500",
  "from-sky-600 to-cyan-400",
  "from-blue-900 to-indigo-600",
];

/** Bento grid: the first category is the big tile. Images can replace the big letter later. */
export default function CategoryBento({ cats }: { cats: { id: string; name: string }[] }) {
  if (cats.length === 0) return null;
  const list = cats.slice(0, 5);
  return (
    <section aria-label="الأقسام" className="space-y-4">
      <Reveal>
        <h2 className="text-2xl font-extrabold sm:text-3xl">تسوّق حسب القسم</h2>
      </Reveal>
      <ul className="grid auto-rows-[9rem] grid-cols-2 gap-3 sm:auto-rows-[11rem] md:grid-cols-4 lg:gap-4">
        {list.map((c, i) => (
          <li key={c.id} className={i === 0 ? "col-span-2 row-span-2" : ""}>
            <Reveal delay={i} scale={0.96} className="h-full">
              <Link
                href={`/products?category=${c.id}`}
                className={`group relative flex h-full flex-col justify-end overflow-hidden rounded-3xl bg-linear-to-br ${TONES[i % TONES.length]} p-5 text-white shadow-(--shadow-card)`}
              >
                {categoryImage(c.name) ? (
                  <>
                    <Image
                      src={categoryImage(c.name)!}
                      alt=""
                      fill
                      sizes={i === 0 ? "(max-width: 768px) 100vw, 50vw" : "(max-width: 768px) 50vw, 25vw"}
                      className="object-cover object-[10%_center] transition-transform duration-700 ease-out group-hover:scale-110"
                    />
                    <span aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-slate-950/85 via-slate-950/25 to-transparent" />
                  </>
                ) : (
                  <span aria-hidden="true" className="absolute -top-4 -end-2 text-[9rem] font-black leading-none text-white/15 transition-transform duration-700 ease-out group-hover:scale-110 group-hover:-rotate-6">
                    {c.name.trim().charAt(0)}
                  </span>
                )}
                <span className={`relative font-extrabold ${i === 0 ? "text-3xl sm:text-4xl" : "text-lg sm:text-xl"}`}>{c.name}</span>
                <span className="relative mt-1 flex items-center gap-1 text-sm text-white/80 transition-all group-hover:gap-3">
                  تصفح القسم <span aria-hidden="true">←</span>
                </span>
              </Link>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}
