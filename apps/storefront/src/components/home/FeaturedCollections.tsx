"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type CSSProperties } from "react";

const TILES = [
  { name: "شنط لابتوب", file: "bag", query: "شنطة", color: "#634936" },
  { name: "ماوس", file: "mouse", query: "ماوس", color: "#c4cbd7" },
  { name: "كيبورد", file: "keyboard", query: "كيبورد", color: "#222634" },
  { name: "لابتوبات", file: "laptop", query: "", color: "#3e647e" },
  { name: "طابعات", file: "printer", query: "طابعة", color: "#5b6268" },
  { name: "شاشات", file: "monitor", query: "شاشة", color: "#6871a3" },
  { name: "راوتر", file: "router", query: "راوتر", color: "#7278a8" },
  { name: "كابلات", file: "cable", query: "كابل", color: "#d19a29" },
  { name: "وحدات التخزين", file: "drive", query: "SSD", color: "#b5672c" },
];

const SIZE = TILES.length;
const HALF = Math.floor(SIZE / 2);

function distance(index: number, center: number) {
  return (index - center + SIZE + HALF) % SIZE - HALF;
}

export default function FeaturedCollections({ categories }: { categories: { id: string; name: string }[] }) {
  const category = categories.find((item) => /لاب|laptop|كمبيوتر/i.test(item.name));
  const laptopHref = category ? `/products?category=${category.id}` : "/products";
  const [position, setPosition] = useState({ current: 4, previous: 4 });

  function move(direction: number) {
    setPosition(({ current }) => ({ previous: current, current: (current + direction + SIZE) % SIZE }));
  }

  return (
    <section id="computers" aria-labelledby="computers-title" className="space-y-3 scroll-mt-36 sm:space-y-5">
      <h2 id="computers-title" className="text-center text-2xl font-extrabold sm:text-3xl">لابتوب وكمبيوتر</h2>
      <ul id="computer-coverflow" dir="ltr" className="computer-coverflow">
        {TILES.map((tile, index) => {
          const offset = distance(index, position.current);
          const depth = Math.abs(offset);
          const jumped = Math.abs(distance(index, position.previous) - offset) > 1;
          const style = {
            "--tile-offset": offset,
            "--tile-scale": 1 + depth * 0.14,
            "--tile-tilt": `${offset * -3}deg`,
            backgroundColor: tile.color,
            zIndex: HALF - depth,
          } as CSSProperties;
          return (
            <li key={tile.file} className="computer-tile" data-depth={depth} data-jump={jumped} style={style}>
              <Link dir="rtl" href={tile.query ? `/products?q=${encodeURIComponent(tile.query)}` : laptopHref} className="group relative isolate flex h-full items-end justify-center overflow-hidden rounded-[inherit] p-2 focus-visible:outline-offset-[-4px] sm:p-3">
                <Image
                  src={`/img/computer-collections/${tile.file}.png`}
                  alt=""
                  fill
                  sizes="(max-width: 639px) 44vw, (max-width: 1023px) 24vw, 16vw"
                  className="-z-20 object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-linear-to-t from-black/65 to-transparent" />
                <span className="rounded-full bg-black/65 px-3 py-1 text-center text-xs font-extrabold text-white sm:text-sm">{tile.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-center gap-2" dir="ltr">
        <button type="button" className="shop-icon-button" aria-label="الكارت اللي على الشمال" aria-controls="computer-coverflow" onClick={() => move(-1)}>‹</button>
        <span className="sr-only" role="status" dir="rtl">{TILES[position.current].name}</span>
        <button type="button" className="shop-icon-button" aria-label="الكارت اللي على اليمين" aria-controls="computer-coverflow" onClick={() => move(1)}>›</button>
      </div>
    </section>
  );
}
