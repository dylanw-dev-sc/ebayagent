"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

/** Right-hand detail panel. URL-driven (?listing=id) so it survives refreshes and is shareable. */
export function DrawerShell({ closeHref, children, label }: { closeHref: string; children: ReactNode; label: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [closeHref, router]);

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={label}>
      <Link href={closeHref} scroll={false} aria-label="Close details" className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[760px] flex-col overflow-hidden bg-canvas shadow-[var(--shadow-panel)]">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-5">
          <p className="eyebrow">Listing details</p>
          <Link href={closeHref} scroll={false} className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-muted hover:text-ink" aria-label="Close">
            <X className="size-5" />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
