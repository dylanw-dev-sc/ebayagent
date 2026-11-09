import Link from "next/link";
import type { ReactNode } from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-full bg-ink px-4 h-9 text-sm font-medium text-white transition hover:bg-black/85 disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-4 h-9 text-sm font-medium text-ink transition hover:border-ink-3 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-full px-3 h-8 text-sm font-medium text-ink-2 transition hover:bg-muted hover:text-ink disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-full border border-exclude/30 bg-surface px-4 h-9 text-sm font-medium text-exclude transition hover:bg-exclude-soft disabled:opacity-50",
  small:
    "inline-flex items-center justify-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 h-7 text-xs font-medium text-ink transition hover:border-ink-3 hover:bg-muted disabled:opacity-50",
};

export type Tone = "match" | "review" | "exclude" | "slate" | "fixture" | "neutral" | "ink";

const toneClass: Record<Tone, string> = {
  match: "bg-match-soft text-match",
  review: "bg-review-soft text-review",
  exclude: "bg-exclude-soft text-exclude",
  slate: "bg-slate-soft text-slate",
  fixture: "bg-fixture-soft text-fixture",
  neutral: "bg-muted text-ink-2",
  ink: "bg-ink text-white",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  const c: Record<Tone, string> = {
    match: "bg-match",
    review: "bg-review",
    exclude: "bg-exclude",
    slate: "bg-slate",
    fixture: "bg-fixture",
    neutral: "bg-ink-3",
    ink: "bg-ink",
  };
  return <span className={cn("inline-block size-1.5 rounded-full", c[tone])} aria-hidden />;
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="font-display text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description ? <p className="mt-2 text-[15px] leading-6 text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({ title, description, actions, id }: { title: string; description?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex scroll-mt-24 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center">
      <p className="font-display text-2xl font-semibold text-ink">{title}</p>
      {children ? <div className="mt-2 max-w-md text-sm leading-6 text-ink-2">{children}</div> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function TabLink({ href, active, children, count }: { href: string; active: boolean; children: ReactNode; count?: number }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        "relative inline-flex h-10 items-center gap-2 px-1 text-sm font-medium transition",
        active ? "text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-ink" : "text-ink-3 hover:text-ink",
      )}
    >
      {children}
      {count !== undefined ? <span className={cn("tabular rounded-full px-1.5 text-[11px] leading-5", active ? "bg-ink text-white" : "bg-muted text-ink-2")}>{count}</span> : null}
    </Link>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-sunken/70", className)} />;
}

export function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="aspect-[4/5] w-full rounded-xl" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-3 border-b border-line pb-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <GridSkeleton />
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}
