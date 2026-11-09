"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "./ui";

/**
 * A table row with an inline, full-width editor row beneath it. (Popovers get
 * clipped by horizontally scrollable tables; an expanding row never does.)
 */
export function ExpandableRow({ cells, editor, colSpan, className, label = "Edit" }: { cells: ReactNode; editor: ReactNode; colSpan: number; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={cn("align-top", open && "bg-canvas/60", className)}>
        {cells}
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition", open ? "bg-ink text-white" : "text-ink-2 hover:bg-muted")}
          >
            {open ? "Close" : label}
            <ChevronDown className={cn("size-3.5 transition", open && "rotate-180")} />
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="bg-canvas/60">
          <td colSpan={colSpan} className="border-t border-line px-4 pt-3 pb-5">
            {editor}
          </td>
        </tr>
      ) : null}
    </>
  );
}
