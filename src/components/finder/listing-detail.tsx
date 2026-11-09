import { CircleAlert, CircleCheck, ExternalLink, Info, CircleX } from "lucide-react";
import { clearPriceOverrideAction, setPriceOverrideAction } from "@/app/actions/listings";
import { MATERIAL_LEVEL_LABEL, PRICING_LABEL, PRICING_TONE, STATE_LABEL, STATE_TONE, formatDateTime, shippingText, timeAgo } from "@/lib/format";
import type { ListingFacts, Reason } from "@/lib/matching/engine";
import { formatBps, formatMoney, minorToInput } from "@/lib/money";
import type { getListingDetail } from "@/server/services/feed";
import { ActionButton, ActionForm, SubmitButton } from "../forms";
import { ColorSwatch } from "../color-swatch";
import { Badge, KeyValue, cn } from "../ui";
import { DetailActions } from "./card-actions";
import { PhotoGallery } from "./photo-gallery";
import { CorrectionPanel } from "./correction-panel";
import { MEASUREMENT_LABEL } from "@/lib/matching/measurements";
import type { Suggestion } from "@/server/services/corrections";

type Detail = NonNullable<ReturnType<typeof getListingDetail>>;

const SOURCE_LABEL: Record<string, string> = {
  item_specifics: "item specifics",
  title: "title",
  ebay_category: "eBay category",
  search_query: "search that found it",
  none: "—",
};

function ReasonIcon({ effect }: { effect: Reason["effect"] }) {
  if (effect === "pass") return <CircleCheck className="mt-0.5 size-4 shrink-0 text-match" />;
  if (effect === "review") return <CircleAlert className="mt-0.5 size-4 shrink-0 text-review" />;
  if (effect === "exclude") return <CircleX className="mt-0.5 size-4 shrink-0 text-exclude" />;
  return <Info className="mt-0.5 size-4 shrink-0 text-ink-3" />;
}

function upperFirst(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function ListingDetail({
  d,
  staleAfterHours,
  corrections,
  brandOptions,
}: {
  d: Detail;
  staleAfterHours: number;
  corrections: Suggestion[];
  brandOptions: Array<{ id: number; name: string }>;
}) {
  const l = d.listing;
  const f = d.facts;
  const currency = l.currency ?? "USD";
  const isFixture = l.source === "fixture";
  const p = d.pricing;
  const reading = f.materialReading;

  return (
    <div className="space-y-8 px-5 py-6 sm:px-7">
      {/* Hero */}
      <div className="grid gap-6 sm:grid-cols-[minmax(0,18rem)_1fr]">
        <PhotoGallery
          images={[l.imageUrl, ...l.additionalImages].filter((x, i, all): x is string => !!x && all.indexOf(x) === i)}
          alt={l.title}
          labelHint={reading.status === "unknown"}
        />
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={STATE_TONE[d.evaluation.state]}>{STATE_LABEL[d.evaluation.state]}</Badge>
            {p ? <Badge tone={PRICING_TONE[p.status]}>{PRICING_LABEL[p.status]}</Badge> : null}
            {isFixture ? <Badge tone="fixture">Fixture — synthetic sample data</Badge> : <Badge tone="neutral">eBay listing</Badge>}
          </div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-ink uppercase">{d.brandName ?? "Brand not matched"}</p>
          <h2 className="font-display text-[1.75rem] leading-tight font-semibold text-ink">{l.title}</h2>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-semibold tabular">{formatMoney(p?.totalMinor ?? l.priceMinor, currency)}</span>
            <span className="text-sm text-ink-3 tabular">
              {p?.totalMinor !== null && p?.totalMinor !== undefined ? `${formatMoney(l.priceMinor, currency)} item · ${shippingText(l.shippingStatus, l.shippingMinor, currency).replace("+ ", "")}` : shippingText(l.shippingStatus, l.shippingMinor, currency)}
            </span>
          </div>
          <p className="text-sm leading-6 text-ink-2">{d.evaluation.summary}</p>
          <DetailActions listingId={l.id} initial={{ saved: d.userState?.saved ?? false, dismissed: d.userState?.dismissed ?? false, reviewed: d.userState?.reviewed ?? false }} />
          {l.itemUrl ? (
            <a href={l.itemUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline-offset-4 hover:underline">
              Open the original listing on eBay <ExternalLink className="size-4" />
            </a>
          ) : (
            <p className="text-sm text-ink-3">{isFixture ? "Fixture items are synthetic and have no eBay page." : "eBay did not provide a listing URL."}</p>
          )}
        </div>
      </div>

      {/* Freshness disclosure (eBay data-use requirement) */}
      {d.stale ? (
        <div className="rounded-xl border border-review/30 bg-review-soft px-4 py-3 text-[13px] leading-5 text-review">
          This listing&apos;s data was last confirmed {timeAgo(l.lastSeenAt)} ({formatDateTime(l.lastSeenAt)}), more than {staleAfterHours} hours ago. Price and availability may have changed — run a scan to refresh it.
        </div>
      ) : null}

      {/* Facts */}
      <section className="card p-5">
        <h3 className="font-display text-xl font-semibold">What the listing says</h3>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <KeyValue label="Brand">
            {d.brandName ?? "No preferred brand found"}
            <span className="block text-xs text-ink-3">{f.brand.note}</span>
          </KeyValue>
          <KeyValue label="Category">
            {d.categoryName ?? "Unknown"}
            <span className="block text-xs text-ink-3">
              {f.category.note}
              {l.ebayCategoryPath ? ` · eBay: ${l.ebayCategoryPath}` : ""}
            </span>
          </KeyValue>
          <KeyValue label="Size">
            {d.evaluation.sizeLabel ?? "Not stated"}
            <span className="block text-xs text-ink-3">
              {f.size.source === "none" ? "No size in item specifics or title" : `From ${SOURCE_LABEL[f.size.source]}${f.size.raw ? ` (“${f.size.raw}”)` : ""}`}
            </span>
          </KeyValue>
          <KeyValue label="Condition">{f.condition.label ?? "Not stated"}</KeyValue>
          <KeyValue label="Material">
            {f.material.summary}
            <span className="block text-xs text-ink-3">
              {MATERIAL_LEVEL_LABEL[f.material.level] ?? f.material.level} ·{" "}
              {reading.status === "composition" ? "fiber percentages stated" : reading.status === "stated" ? "fibers named without percentages" : "seller gave no composition"}
            </span>
          </KeyValue>
          <KeyValue label="Color">
            {f.color?.keys.length ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {f.color.keys.map((k, i) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <ColorSwatch colorKey={k} />
                    {f.color!.names[i] ?? k}
                  </span>
                ))}
              </span>
            ) : (
              "Not stated"
            )}
            <span className="block text-xs text-ink-3">{colorNote(f.color)}</span>
          </KeyValue>
          <KeyValue label="Measurements">
            {f.measurements?.found.length ? (
              <ul className="space-y-0.5">
                {f.measurements.found.map((m) => (
                  <li key={m.key}>
                    {MEASUREMENT_LABEL[m.key]} {m.inches} in
                    {m.note ? <span className="text-xs text-ink-3"> ({m.note})</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              "None stated"
            )}
            <span className="block text-xs text-ink-3">Flat garment measurements read from the description or title</span>
          </KeyValue>
          <KeyValue label="Authenticity">
            {f.redFlags?.length ? <span className="text-exclude">Red flag: {f.redFlags.map((x) => `“${x}”`).join(", ")}</span> : "No red-flag phrases found"}
            <span className="block text-xs text-ink-3">Phrases like “replica” or “inspired by” (Preferences → Other defaults)</span>
          </KeyValue>
          <KeyValue label="Material notes">
            <ul className="space-y-0.5 text-xs text-ink-2">
              {reading.facts.map((x) => (
                <li key={x}>Fact: {x}</li>
              ))}
              {reading.claims.map((x) => (
                <li key={x}>Seller claim (not verified): {x}</li>
              ))}
              {reading.fauxDetected.map((x) => (
                <li key={x}>Faux {x} detected — not counted as genuine</li>
              ))}
              {reading.liningIgnored.map((x) => (
                <li key={x}>Lining ({x}) ignored for the shell fabric</li>
              ))}
              {!reading.facts.length && !reading.claims.length && !reading.fauxDetected.length && !reading.liningIgnored.length ? <li className="text-ink-3">None</li> : null}
            </ul>
          </KeyValue>
        </dl>
      </section>

      {/* Match decisions per profile */}
      <section className="card p-5">
        <h3 className="font-display text-xl font-semibold">Why — by search profile</h3>
        <p className="mt-1 text-[13px] text-ink-3">Every enabled profile judges the same facts. The listing appears once in the feed with all matching profiles recorded.</p>
        <ul className="mt-4 divide-y divide-line">
          {d.profiles.map((pr) => (
            <li key={pr.profileId} className="py-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">{pr.name}</p>
                <Badge tone={STATE_TONE[pr.state]}>{STATE_LABEL[pr.state]}</Badge>
              </div>
              <ul className="mt-2 space-y-1">
                {pr.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-5 text-ink-2">
                    <ReasonIcon effect={r.effect} />
                    <span>
                      <span className="text-ink-3 capitalize">{r.dimension}:</span> {upperFirst(r.message)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {d.profiles.length === 0 ? <li className="py-3 text-sm text-ink-3">No enabled search profiles.</li> : null}
        </ul>
      </section>

      <CorrectionPanel suggestions={corrections} brands={brandOptions} />

      {/* Pricing */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-xl font-semibold">Cost Evaluator</h3>
          {p ? <Badge tone={PRICING_TONE[p.status]}>{PRICING_LABEL[p.status]}</Badge> : null}
        </div>
        <p className="mt-2 text-sm leading-6 text-ink-2">{p?.explanation ?? "Not evaluated yet."}</p>
        {p && p.maxPriceMinor !== null ? (
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KeyValue label="Rule">{p.ruleLevel === "override" ? "Product override" : p.ruleLevel === "brand_category" ? "Brand + category" : "Category-wide"}</KeyValue>
            <KeyValue label="Reference retail">{formatMoney(p.referenceRetailMinor, currency)}</KeyValue>
            <KeyValue label="Allowed">{formatBps(p.allowedBps)}</KeyValue>
            <KeyValue label="Max secondhand">{formatMoney(p.maxPriceMinor, currency)}</KeyValue>
          </dl>
        ) : null}
        <p className="mt-3 text-xs text-ink-3">Price eligibility only checks your ceiling — it is not a bargain or market-value rating.</p>

        <div className="mt-5 rounded-lg border border-line bg-canvas p-4">
          <p className="text-sm font-semibold text-ink">Product-specific override</p>
          <p className="mt-0.5 text-xs text-ink-3">Takes precedence over brand/category and category-wide rules for this listing only.</p>
          <ActionForm action={setPriceOverrideAction} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input type="hidden" name="listingId" value={l.id} />
            <label className="col-span-1">
              <span className="label">Retail (USD)</span>
              <input name="retail" inputMode="decimal" required defaultValue={d.override ? minorToInput(d.override.referenceRetailMinor) : ""} placeholder="e.g. 1450" className="field" />
            </label>
            <label className="col-span-1">
              <span className="label">Allowed %</span>
              <input name="percent" inputMode="decimal" required defaultValue={d.override ? formatBps(d.override.allowedBps).replace("%", "") : p?.allowedBps ? formatBps(p.allowedBps).replace("%", "") : ""} placeholder="e.g. 35" className="field" />
            </label>
            <label className="col-span-2">
              <span className="label">Retail source</span>
              <input name="source" defaultValue={d.override?.retailSource ?? ""} placeholder="Where the retail price came from" className="field" />
            </label>
            <div className="col-span-2 flex items-end gap-2 sm:col-span-4">
              <SubmitButton variant="secondary">{d.override ? "Update override" : "Save override"}</SubmitButton>
              {d.override ? (
                <ActionButton action={clearPriceOverrideAction.bind(null, l.id)} variant="ghost">
                  Remove override
                </ActionButton>
              ) : null}
            </div>
          </ActionForm>
        </div>
      </section>

      {/* Data provenance */}
      <section className="card p-5">
        <h3 className="font-display text-xl font-semibold">Data</h3>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <KeyValue label="Source">{isFixture ? "Fixture (synthetic)" : "eBay Browse API"}</KeyValue>
          <KeyValue label={isFixture ? "Fixture ID" : "eBay item ID"}>
            <span className="break-all">{l.legacyId ?? l.externalId}</span>
          </KeyValue>
          <KeyValue label="Listed">{formatDateTime(l.listedAt)}</KeyValue>
          <KeyValue label="Last checked">
            <span className={cn(d.stale && "text-review")}>{formatDateTime(l.lastSeenAt)}</span>
          </KeyValue>
          <KeyValue label="First seen">{formatDateTime(l.firstSeenAt)}</KeyValue>
          <KeyValue label="Item specifics">{l.detailsFetchedAt ? `Fetched ${timeAgo(l.detailsFetchedAt)}` : "Not fetched (search summary only)"}</KeyValue>
        </dl>
        {l.aspects.length ? (
          <table className="mt-5 w-full text-left text-[13px]">
            <tbody className="divide-y divide-line">
              {l.aspects.map((a, i) => (
                <tr key={i}>
                  <th className="w-44 py-1.5 pr-4 font-medium text-ink-3">{a.name}</th>
                  <td className="py-1.5 text-ink-2">{a.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}

function colorNote(c: ListingFacts["color"]): string {
  if (!c) return "Not checked yet: re-evaluate listings or run a scan";
  const aspect = c.aspect ? `“${c.aspect}”` : null;
  if (c.source === "none") return aspect ? `Item specifics say ${aspect}, which isn't one of your colors` : "No color in the title or item specifics";
  if (c.source === "item_specifics") return `From item specifics (${aspect})`;
  const words = (c.titleWords ?? []).map((w) => `“${w}”`).join(", ");
  return c.source === "both" ? `From the title (${words}) and item specifics (${aspect})` : `From the title (${words})`;
}
