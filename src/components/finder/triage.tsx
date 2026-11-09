"use client";

import { ChevronLeft, ChevronRight, Keyboard } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { recordFinderVisitAction, setListingStateAction } from "@/app/actions/listings";
import type { ListingSource } from "@/lib/domain/types";
import { cn } from "../ui";

/**
 * Keyboard triage in the listing detail view:
 *   S save / unsave · D dismiss (and move on) · R mark reviewed (and move on)
 *   J or → next · K or ← previous · Esc close (handled by the drawer)
 */
export function TriageKeys({
  listingId,
  saved,
  dismissed,
  reviewed,
  nextHref,
  prevHref,
  closeHref,
}: {
  listingId: number;
  saved: boolean;
  dismissed: boolean;
  reviewed: boolean;
  nextHref: string | null;
  prevHref: string | null;
  closeHref: string;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const busy = useRef(false);

  useEffect(() => {
    const go = (href: string | null) => href && router.push(href, { scroll: false });
    const act = (patch: { saved?: boolean; dismissed?: boolean; reviewed?: boolean }, then?: string | null) => {
      if (busy.current) return;
      busy.current = true;
      // Move on first, then save: the save's page refresh must not cancel the navigation.
      if (then) go(then);
      start(async () => {
        await setListingStateAction(listingId, patch);
        busy.current = false;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true'], [data-gallery]")) return;
      switch (e.key.toLowerCase()) {
        case "j":
        case "arrowright":
          go(nextHref);
          break;
        case "k":
        case "arrowleft":
          go(prevHref);
          break;
        case "s":
          act({ saved: !saved });
          break;
        case "d":
          act({ dismissed: !dismissed }, dismissed ? undefined : nextHref ?? closeHref);
          break;
        case "r":
          act({ reviewed: !reviewed }, reviewed ? undefined : nextHref ?? undefined);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listingId, saved, dismissed, reviewed, nextHref, prevHref, closeHref, router]);

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-5 py-2 text-[11.5px] text-ink-3 sm:px-7">
      <Keyboard className="size-3.5" />
      {[
        ["S", "save"],
        ["D", "dismiss & next"],
        ["R", "reviewed & next"],
        ["J / →", "next"],
        ["K / ←", "previous"],
        ["Esc", "close"],
      ].map(([k, label]) => (
        <span key={k}>
          <kbd className="rounded border border-line-strong bg-canvas px-1 font-sans text-[10.5px] text-ink-2">{k}</kbd> {label}
        </span>
      ))}
    </p>
  );
}

export function DrawerNav({ prevHref, nextHref, position }: { prevHref: string | null; nextHref: string | null; position: string | null }) {
  const btn = "grid size-8 place-items-center rounded-full text-ink-2 transition hover:bg-muted hover:text-ink";
  return (
    <div className="flex items-center gap-1">
      {position ? <span className="mr-1 text-[12px] text-ink-3 tabular">{position}</span> : null}
      {prevHref ? (
        <Link href={prevHref} scroll={false} className={btn} aria-label="Previous listing">
          <ChevronLeft className="size-4" />
        </Link>
      ) : (
        <span className={cn(btn, "pointer-events-none opacity-30")} aria-hidden>
          <ChevronLeft className="size-4" />
        </span>
      )}
      {nextHref ? (
        <Link href={nextHref} scroll={false} className={btn} aria-label="Next listing">
          <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span className={cn(btn, "pointer-events-none opacity-30")} aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      )}
    </div>
  );
}

/** Records that you looked at the Finder (for "New since your last visit"). */
export function VisitTracker({ source }: { source: ListingSource }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void recordFinderVisitAction(source);
  }, [source]);
  return null;
}
