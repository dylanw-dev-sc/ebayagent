"use client";

import { Activity, Bookmark, LayoutGrid, Menu, Scale, Settings2, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { cn } from "../ui";

export const NAV = [
  { href: "/finder", label: "Product Finder", icon: LayoutGrid },
  { href: "/cost", label: "Cost Evaluator", icon: Scale },
  { href: "/saved", label: "Saved Items", icon: Bookmark },
  { href: "/profiles", label: "Search Profiles", icon: SlidersHorizontal },
  { href: "/preferences", label: "Preferences", icon: Settings2 },
];

/**
 * The active-link highlight needs the pathname, which is runtime data on
 * dynamic routes (e.g. /profiles/[id]); under Cache Components it must sit
 * inside <Suspense>. The fallback renders the same links without highlight.
 */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavList pathname="" onNavigate={onNavigate} />}>
      <ActiveNavLinks onNavigate={onNavigate} />
    </Suspense>
  );
}

function ActiveNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return <NavList pathname={pathname} onNavigate={onNavigate} />;
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition",
              active ? "bg-ink text-white" : "text-ink-2 hover:bg-muted hover:text-ink",
            )}
          >
            <Icon className={cn("size-4", active ? "text-white" : "text-ink-3 group-hover:text-ink")} strokeWidth={1.75} />
            {label}
          </Link>
        );
      })}
      <div className="my-2 border-t border-line" />
      <Link
        href="/scans"
        onClick={onNavigate}
        aria-current={pathname.startsWith("/scans") ? "page" : undefined}
        className={cn(
          "group flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition",
          pathname.startsWith("/scans") ? "bg-ink text-white" : "text-ink-2 hover:bg-muted hover:text-ink",
        )}
      >
        <Activity className={cn("size-4", pathname.startsWith("/scans") ? "text-white" : "text-ink-3 group-hover:text-ink")} strokeWidth={1.75} />
        Scans & Status
      </Link>
    </nav>
  );
}

export function MobileNav({ status }: { status: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas/95 px-4 backdrop-blur">
        <Link href="/finder" className="font-display text-xl font-semibold tracking-tight text-ink">
          Clothing Finder
        </Link>
        <button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="grid size-9 place-items-center rounded-full hover:bg-muted">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 top-14 z-30 overflow-y-auto bg-canvas px-4 py-4">
          <NavLinks onNavigate={() => setOpen(false)} />
          <div className="mt-6">{status}</div>
        </div>
      ) : null}
    </div>
  );
}
