import Link from "next/link";
import { MATERIAL_LEVEL_LABEL, PRICING_LABEL, PRICING_TONE, STATE_LABEL, STATE_TONE, shippingText, timeAgo } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { FeedItem } from "@/server/services/feed";
import { Badge, cn } from "../ui";
import { CardActions, SaveButton } from "./card-actions";

export function ListingCard({ item, detailHref, showReason, priority }: { item: FeedItem; detailHref: string; showReason: boolean; priority?: boolean }) {
  const currency = item.currency ?? "USD";
  const isFixture = item.source === "fixture";
  const shipKnown = item.shippingStatus === "free" || (item.shippingStatus === "fixed" && item.shippingMinor !== null);
  const showTotal = shipKnown && item.totalMinor !== null;

  return (
    <article className="group flex min-w-0 flex-col">
      <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-muted ring-1 ring-line/60">
        <Link href={detailHref} scroll={false} className="block size-full" aria-label={`View details: ${item.title}`}>
          {item.imageUrl ? (
            // Plain <img>: eBay images are shown directly from eBay's CDN, never copied or re-hosted.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt={item.title}
              loading={priority ? "eager" : "lazy"}
              decoding="async"
              className="size-full object-cover transition duration-500 group-hover:scale-[1.025]"
            />
          ) : (
            <div className="grid size-full place-items-center text-xs text-ink-3">No image provided</div>
          )}
        </Link>
        <div className="pointer-events-none absolute inset-x-2.5 top-2.5 flex items-start justify-between">
          <span className="pointer-events-auto flex gap-1">
            <Badge tone={STATE_TONE[item.state]} className="shadow-sm">
              {STATE_LABEL[item.state]}
            </Badge>
            {item.isNew ? (
              <Badge tone="ink" className="shadow-sm" title="First seen since your last visit">
                New
              </Badge>
            ) : null}
          </span>
          <div className="pointer-events-auto">
            <SaveButton listingId={item.id} initial={{ saved: item.saved, dismissed: item.dismissed, reviewed: item.reviewed }} />
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-2.5 bottom-2.5 flex flex-wrap gap-1">
          {isFixture ? <Badge tone="fixture" className="shadow-sm">Fixture</Badge> : null}
          {item.redFlags.length ? (
            <Badge tone="exclude" className="shadow-sm" title={`Counterfeit red flag: ${item.redFlags.join(", ")}`}>
              Red flag
            </Badge>
          ) : null}
          {item.isAuction ? <Badge tone="ink" className="shadow-sm">Auction · current bid</Badge> : null}
          {item.stale ? (
            <Badge tone="review" className="shadow-sm" title="Listing data may be out of date; rescan to refresh.">
              Checked {timeAgo(item.lastSeenAt)}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[11px] font-semibold tracking-[0.12em] text-ink uppercase">{item.brandName ?? "Brand not matched"}</p>
          {item.sizeLabel ? <span className="shrink-0 rounded-md border border-line-strong px-1.5 text-[11px] leading-5 font-semibold text-ink-2 tabular">{item.sizeLabel}</span> : null}
        </div>
        <Link href={detailHref} scroll={false} className="line-clamp-2 text-[13.5px] leading-[1.35rem] text-ink-2 transition hover:text-ink">
          {item.title}
        </Link>
        <p className="truncate text-[12px] text-ink-3" title={`${item.materialSummary} · ${MATERIAL_LEVEL_LABEL[item.materialLevel] ?? ""}`}>
          <span className={cn(item.materialLevel === "avoid" && "text-review", item.materialLevel === "unknown" && "italic")}>
            {item.materialLevel === "unknown" ? "Fabric not stated" : item.materialSummary}
          </span>
          {item.conditionLabel ? <> · {item.conditionLabel}</> : null}
        </p>

        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <p className="text-[15px] font-semibold text-ink tabular">
            {showTotal ? formatMoney(item.totalMinor, currency) : formatMoney(item.priceMinor, currency)}
            {item.currency && item.currency !== "USD" ? <span className="ml-1 text-[11px] font-medium text-review">{item.currency}</span> : null}
          </p>
          <p className={cn("truncate text-[11.5px] tabular", shipKnown ? "text-ink-3" : "text-review")}>
            {showTotal && item.shippingStatus === "fixed" ? `${formatMoney(item.priceMinor, currency)} + ${formatMoney(item.shippingMinor, currency)} ship` : shippingText(item.shippingStatus, item.shippingMinor, currency)}
          </p>
        </div>
        {item.pricingStatus ? (
          <div className="flex items-center gap-1.5">
            <Badge tone={PRICING_TONE[item.pricingStatus]} title={item.pricingExplanation ?? undefined}>
              {PRICING_LABEL[item.pricingStatus]}
            </Badge>
            {item.maxPriceMinor !== null ? <span className="text-[11.5px] text-ink-3 tabular">max {formatMoney(item.maxPriceMinor, currency)}</span> : null}
          </div>
        ) : null}

        {showReason ? (
          <p className="mt-1 line-clamp-2 text-[12px] leading-[1.15rem] text-ink-2">{item.summary}</p>
        ) : item.matchedProfileNames.length ? (
          <p className="mt-1 truncate text-[11.5px] text-ink-3" title={item.matchedProfileNames.join(", ")}>
            {item.matchedProfileNames.length === 1 ? item.matchedProfileNames[0] : `${item.matchedProfileNames[0]} +${item.matchedProfileNames.length - 1} more profiles`}
          </p>
        ) : null}

        <div className="mt-auto">
          <CardActions listingId={item.id} initial={{ saved: item.saved, dismissed: item.dismissed, reviewed: item.reviewed }} itemUrl={item.itemUrl} isFixture={isFixture} />
        </div>
      </div>
    </article>
  );
}
