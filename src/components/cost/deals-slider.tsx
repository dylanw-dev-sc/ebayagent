"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { saveDefaultPercentAction } from "@/app/actions/pricing";
import { STATE_LABEL, STATE_TONE } from "@/lib/format";
import type { MatchState } from "@/lib/domain/types";
import { formatMoney } from "@/lib/money";
import { formatPctOfRetail, RULE_LEVEL_LABEL, type RuleLevel } from "@/lib/pricing/engine";
import { ActionButton } from "../forms";
import { Badge, cn } from "../ui";

export interface DealItem {
  id: number;
  title: string;
  imageUrl: string | null;
  isFixture: boolean;
  brandName: string | null;
  categoryName: string | null;
  state: MatchState;
  totalMinor: number | null;
  priceMinor: number | null;
  currency: string;
  referenceRetailMinor: number | null;
  ruleLevel: string | null;
  pctOfRetailBps: number;
  pctIsLowerBound: boolean;
}

const SHOW_MAX = 60;

/**
 * "What share of the new price am I paying?" Drag to see listings at or below a
 * share of retail; the list filters instantly. Saving makes it your default %.
 */
export function DealsSlider({ items, defaultPercent }: { items: DealItem[]; defaultPercent: number }) {
  const [pct, setPct] = useState(defaultPercent);
  const shown = useMemo(() => items.filter((i) => i.pctOfRetailBps <= pct * 100), [items, pct]);

  return (
    <section className="card space-y-4 p-5" aria-labelledby="deals-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow" id="deals-title">
            Deals by % of retail
          </p>
          <p className="mt-1 font-display text-2xl font-semibold">
            <span className="tabular">{shown.length}</span> of <span className="tabular">{items.length}</span> listings cost{" "}
            <span className="tabular">{pct}%</span> of their new price or less
          </p>
          <p className="mt-1 text-xs text-ink-3">
            Total with shipping ÷ the reference new price. “+” means shipping is unknown, so the share covers the item price only. Your default is {defaultPercent}%.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-3 text-[13px] text-ink-2">
            <span className="sr-only">Maximum % of retail</span>
            <input
              type="range"
              min={5}
              max={80}
              step={1}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              aria-label="Maximum % of retail"
              aria-valuetext={`${pct}% of retail`}
              className="w-56 accent-ink"
            />
            <span className="w-11 text-right text-base font-semibold text-ink tabular">{pct}%</span>
          </label>
          {pct !== defaultPercent ? (
            <ActionButton action={saveDefaultPercentAction.bind(null, pct)} variant="secondary">
              Make {pct}% my default
            </ActionButton>
          ) : (
            <span className="rounded-full bg-match-soft px-3 py-1.5 text-[13px] font-medium text-match">Your default</span>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg bg-canvas px-4 py-6 text-center text-sm text-ink-2">
          No listing has a reference new price yet. Add your prices below (grid or CSV), set one on a listing, or use a seller&apos;s stated retail.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg bg-canvas px-4 py-6 text-center text-sm text-ink-2">Nothing at or below {pct}% — drag the slider right.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {shown.slice(0, SHOW_MAX).map((it) => (
            <li key={it.id} className="flex items-center gap-4 p-3">
              <Link href={`/finder?view=all&listing=${it.id}`} className="block w-12 shrink-0 overflow-hidden rounded-md bg-muted ring-1 ring-line">
                {it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.imageUrl} alt="" loading="lazy" className="aspect-[4/5] w-full object-cover" />
                ) : (
                  <div className="aspect-[4/5]" />
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={STATE_TONE[it.state]}>{STATE_LABEL[it.state]}</Badge>
                  {it.isFixture ? <Badge tone="fixture">Fixture</Badge> : null}
                  <span className="text-[11px] font-semibold tracking-[0.12em] uppercase">{it.brandName ?? "Brand not matched"}</span>
                </div>
                <Link href={`/finder?view=all&listing=${it.id}`} className="mt-0.5 line-clamp-1 text-sm text-ink-2 hover:text-ink">
                  {it.title}
                </Link>
                <p className="text-xs text-ink-3">
                  {formatMoney(it.totalMinor ?? it.priceMinor, it.currency)} {it.totalMinor !== null ? "total" : "+ shipping (unknown)"} of{" "}
                  {formatMoney(it.referenceRetailMinor, it.currency)} new · {it.ruleLevel ? RULE_LEVEL_LABEL[it.ruleLevel as RuleLevel] ?? it.ruleLevel : "—"}
                </p>
              </div>
              <p
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold tabular",
                  it.pctOfRetailBps <= defaultPercent * 100 ? "bg-match-soft text-match" : "bg-muted text-ink-2",
                )}
                title="Share of the new price"
              >
                {formatPctOfRetail(it.pctOfRetailBps, it.pctIsLowerBound)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {shown.length > SHOW_MAX ? <p className="text-xs text-ink-3">Showing the {SHOW_MAX} lowest shares; drag left to narrow.</p> : null}
    </section>
  );
}
