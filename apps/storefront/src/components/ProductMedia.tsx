"use client";

import Image from "next/image";
import { useId, useRef, useState } from "react";
import { PHONE_PLACEHOLDER } from "@/lib/site-images";

export default function ProductMedia({ name, images }: {
  name: string;
  images: { src: string; illustrative: boolean }[];
}) {
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = useId();
  const image = images[index] ?? images[0];
  const phonePlaceholder = image?.src === PHONE_PLACEHOLDER;

  return (
    <div className="card space-y-3 p-3 sm:p-5">
      {image && !phonePlaceholder ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-controls={dialogId}
          aria-label={`تكبير صورة ${name}`}
          onClick={() => {
            dialog.current?.showModal();
            closeButton.current?.focus();
          }}
          className="group relative block aspect-square w-full cursor-zoom-in overflow-hidden rounded-2xl bg-white"
        >
          <Image key={image.src} src={image.src} alt={name} fill sizes="(max-width: 767px) 90vw, 44vw" unoptimized={image.src.endsWith(".svg")} className="shop-image-enter object-contain p-[8%] transition-transform duration-500 group-hover:scale-105" />
          <span className="absolute end-3 bottom-3 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold">تكبير الصورة ↗</span>
        </button>
      ) : (
        <div className="relative grid aspect-square place-items-center rounded-2xl bg-bg text-sm text-muted">
          {phonePlaceholder && <Image src={PHONE_PLACEHOLDER} alt="" fill unoptimized className="object-contain p-[14%] opacity-75" />}
          <p className="relative mt-auto mb-4 rounded-full bg-surface px-3 py-1">صورة المنتج غير متاحة</p>
        </div>
      )}
      {images.length > 1 && (
        <ul className="shop-rail flex gap-2 overflow-x-auto p-1" aria-label="صور المنتج">
          {images.map(({ src }, i) => (
            <li key={src}>
              <button
                type="button"
                aria-label={`الصورة ${i + 1}`}
                aria-pressed={index === i}
                onClick={() => setIndex(i)}
                className="relative block size-16 overflow-hidden rounded-xl border border-line bg-white aria-pressed:border-accent aria-pressed:ring-1 aria-pressed:ring-accent"
              >
                <Image src={src} alt="" fill sizes="64px" unoptimized={src.endsWith(".svg")} className="object-contain p-1" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {image?.illustrative && !phonePlaceholder && <p className="px-1 text-xs text-muted">صورة استرشادية. راجع اسم الجهاز ومواصفات الإصدار قبل الحجز.</p>}
      <dialog
        ref={dialog}
        id={dialogId}
        aria-labelledby={titleId}
        className="shop-dialog shop-popup bg-surface text-fg"
        onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      >
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 id={titleId} className="font-bold" dir="auto">{name}</h2>
            <button ref={closeButton} type="button" aria-label="إغلاق الصورة" className="shop-icon-button" onClick={() => dialog.current?.close()}>×</button>
          </div>
          {image && !phonePlaceholder && (
            <div className="relative h-[min(68dvh,38rem)] rounded-xl bg-white">
              <Image src={image.src} alt={name} fill sizes="(max-width: 768px) 90vw, 700px" unoptimized={image.src.endsWith(".svg")} className="object-contain p-3" />
            </div>
          )}
          {image?.illustrative && !phonePlaceholder && <p className="text-xs text-muted">صورة استرشادية</p>}
        </div>
      </dialog>
    </div>
  );
}
