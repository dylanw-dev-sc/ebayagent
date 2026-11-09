"use client";

import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import { cn } from "../ui";

/**
 * Listing photos at a useful size, so details like a care label can be read
 * by eye. Photos are shown straight from the source (eBay's image CDN) and
 * are never analyzed or stored by the app.
 */
export function PhotoGallery({ images, alt, labelHint }: { images: string[]; alt: string; labelHint?: boolean }) {
  const [index, setIndex] = useState(0);
  if (images.length === 0) {
    return <div className="grid aspect-[4/5] place-items-center rounded-xl bg-muted text-xs text-ink-3 ring-1 ring-line">No image provided</div>;
  }
  const i = Math.min(index, images.length - 1);
  const current = images[i];
  const go = (delta: number) => setIndex((n) => (n + delta + images.length) % images.length);

  return (
    <div className="space-y-2">
      <div
        className="relative aspect-[4/5] overflow-hidden rounded-xl bg-muted ring-1 ring-line focus-visible:outline-2"
        tabIndex={images.length > 1 ? 0 : -1}
        aria-label={`Photos: ${i + 1} of ${images.length}. Use the arrow keys to browse.`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current} alt={`${alt} — photo ${i + 1} of ${images.length}`} className="size-full object-contain" />
        {images.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => go(-1)}
              className="absolute top-1/2 left-2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink shadow-sm hover:bg-white"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => go(1)}
              className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink shadow-sm hover:bg-white"
            >
              <ChevronRight className="size-4" />
            </button>
            <span className="absolute bottom-2 left-2 rounded-full bg-ink/75 px-2 text-[11px] leading-5 text-white tabular">
              {i + 1} / {images.length}
            </span>
          </>
        ) : null}
        <a
          href={current}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-ink shadow-sm hover:bg-white"
        >
          Full size <ExternalLink className="size-3" />
        </a>
      </div>
      {images.length > 1 ? (
        <div className="grid grid-cols-5 gap-1.5">
          {images.map((src, n) => (
            <button
              key={`${src}-${n}`}
              type="button"
              onClick={() => setIndex(n)}
              aria-label={`Show photo ${n + 1}`}
              aria-current={n === i}
              className={cn("aspect-square overflow-hidden rounded-md bg-muted ring-1 transition", n === i ? "ring-2 ring-ink" : "ring-line hover:ring-ink-3")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
      {labelHint ? (
        <p className="text-[11.5px] leading-4 text-ink-3">Fabric isn&apos;t read from photos — if there&apos;s a care-label shot, check it here.</p>
      ) : null}
    </div>
  );
}
