"use client";

import { Bookmark, BookmarkCheck, Check, ExternalLink, EyeOff, Undo2 } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { setListingStateAction } from "@/app/actions/listings";
import { cn } from "../ui";

interface State {
  saved: boolean;
  dismissed: boolean;
  reviewed: boolean;
}

function useListingState(listingId: number, initial: State) {
  const [state, setOptimistic] = useOptimistic(initial, (cur: State, patch: Partial<State>) => {
    const next = { ...cur, ...patch };
    if (patch.saved) next.dismissed = false;
    if (patch.dismissed) next.saved = false;
    return next;
  });
  const [pending, start] = useTransition();
  const update = (patch: Partial<State>) =>
    start(async () => {
      setOptimistic(patch);
      await setListingStateAction(listingId, patch);
    });
  return { state, pending, update };
}

export function SaveButton({ listingId, initial }: { listingId: number; initial: State }) {
  const { state, update } = useListingState(listingId, initial);
  return (
    <button
      type="button"
      onClick={() => update({ saved: !state.saved })}
      aria-pressed={state.saved}
      aria-label={state.saved ? "Remove from saved" : "Save item"}
      title={state.saved ? "Saved — click to remove" : "Save item"}
      className={cn(
        "grid size-9 place-items-center rounded-full border shadow-sm backdrop-blur transition",
        state.saved ? "border-ink bg-ink text-white" : "border-white/60 bg-white/85 text-ink hover:bg-white",
      )}
    >
      {state.saved ? <BookmarkCheck className="size-4" strokeWidth={2} /> : <Bookmark className="size-4" strokeWidth={1.75} />}
    </button>
  );
}

export function CardActions({ listingId, initial, itemUrl, isFixture }: { listingId: number; initial: State; itemUrl: string | null; isFixture: boolean }) {
  const { state, update } = useListingState(listingId, initial);
  const link = "inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12px] font-medium transition";
  return (
    <div className="flex flex-wrap items-center gap-1 pt-1">
      <button
        type="button"
        onClick={() => update({ dismissed: !state.dismissed })}
        className={cn(link, state.dismissed ? "bg-exclude-soft text-exclude" : "text-ink-3 hover:bg-muted hover:text-ink")}
        title={state.dismissed ? "Restore to feed" : "Dismiss — hide from the feed"}
      >
        {state.dismissed ? <Undo2 className="size-3.5" /> : <EyeOff className="size-3.5" />}
        {state.dismissed ? "Restore" : "Dismiss"}
      </button>
      <button
        type="button"
        onClick={() => update({ reviewed: !state.reviewed })}
        className={cn(link, state.reviewed ? "bg-match-soft text-match" : "text-ink-3 hover:bg-muted hover:text-ink")}
        aria-pressed={state.reviewed}
        title={state.reviewed ? "Marked reviewed — click to undo" : "Mark as reviewed"}
      >
        <Check className="size-3.5" />
        {state.reviewed ? "Reviewed" : "Mark reviewed"}
      </button>
      {itemUrl ? (
        <a href={itemUrl} target="_blank" rel="noopener noreferrer" className={cn(link, "ml-auto text-ink hover:bg-muted")} title="Open the original listing on eBay">
          eBay <ExternalLink className="size-3.5" />
        </a>
      ) : (
        <span className={cn(link, "ml-auto cursor-default text-ink-3")} title={isFixture ? "Fixture items are synthetic and have no eBay page" : "No eBay URL provided"}>
          {isFixture ? "No eBay page" : "No link"}
        </span>
      )}
    </div>
  );
}

export function DetailActions({ listingId, initial }: { listingId: number; initial: State }) {
  const { state, update } = useListingState(listingId, initial);
  const btn = "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition";
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => update({ saved: !state.saved })} className={cn(btn, state.saved ? "border-ink bg-ink text-white" : "border-line-strong bg-surface hover:bg-muted")}>
        {state.saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
        {state.saved ? "Saved" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => update({ reviewed: !state.reviewed })}
        className={cn(btn, state.reviewed ? "border-match/40 bg-match-soft text-match" : "border-line-strong bg-surface hover:bg-muted")}
      >
        <Check className="size-4" />
        {state.reviewed ? "Reviewed" : "Mark reviewed"}
      </button>
      <button
        type="button"
        onClick={() => update({ dismissed: !state.dismissed })}
        className={cn(btn, state.dismissed ? "border-exclude/40 bg-exclude-soft text-exclude" : "border-line-strong bg-surface hover:bg-muted")}
      >
        {state.dismissed ? <Undo2 className="size-4" /> : <EyeOff className="size-4" />}
        {state.dismissed ? "Restore" : "Dismiss"}
      </button>
    </div>
  );
}
