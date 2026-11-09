import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { deleteRuleAction, toggleRuleAction } from "@/app/actions/pricing";
import { DealsSlider } from "@/components/cost/deals-slider";
import { OnlineLookupSettingsForm } from "@/components/cost/online-lookups";
import { RuleForm } from "@/components/cost/rule-form";
import { CsvImportForm, RuleGrid, type GridValue } from "@/components/cost/rule-grid";
import { ExpandableRow } from "@/components/expandable-row";
import { ActionButton, Toggle } from "@/components/forms";
import { Badge, PageHeader, PageSkeleton, SectionTitle, TabLink, cn } from "@/components/ui";
import { PRICING_LABEL, PRICING_TONE, STATE_LABEL, STATE_TONE, shippingText, timeAgo } from "@/lib/format";
import { formatBps, formatMoney, minorToInput } from "@/lib/money";
import { loadBrands, loadCategories, loadMaterials, loadPricingSettings } from "@/server/services/context";
import { getDealsByPctOfRetail, getPricingList, type PricingFilter } from "@/server/services/feed";
import { MAX_MONTHLY_LOOKUPS } from "@/server/db/seed-data";
import { listPricingRules } from "@/server/services/pricing";
import { lookupUsage, recentLookups, retailDepsFor } from "@/server/services/retail-lookup";
import { getSystemStatus } from "@/server/services/status";
import { requestDb } from "@/server/request";

export const metadata: Metadata = { title: "Cost Evaluator" };

const LISTS: Array<{ key: PricingFilter; label: string }> = [
  { key: "eligible", label: "Price-eligible" },
  { key: "over_ceiling", label: "Over ceiling (excluded)" },
  { key: "needs_review", label: "Needs pricing review" },
];

export default function CostPage({ searchParams }: PageProps<"/cost">) {
  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Engine 2"
        title="Cost Evaluator"
        description={
          <>
            What share of the new price would you pay? % of retail = item price + shipping ÷ the reference new price. Your ceiling = reference new price × your allowed %. Anything above it stays available below, marked over ceiling. This is a ceiling check, not a bargain rating.
          </>
        }
      />
      <Suspense fallback={<PageSkeleton />}>
        <CostContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CostContent({ searchParams }: { searchParams: PageProps<"/cost">["searchParams"] }) {
  const sp = await searchParams;
  const db = await requestDb();
  const source = getSystemStatus(db).dataSource;
  const list = (LISTS.find((l) => l.key === sp.list)?.key ?? "eligible") as PricingFilter;
  const includeAll = sp.scope === "all";
  const rules = listPricingRules(db);
  const categoryRows = loadCategories(db);
  const brandRows = loadBrands(db);
  const categories = categoryRows.map((c) => ({ id: c.id, name: c.name }));
  const brands = brandRows.map((b) => ({ id: b.id, name: b.name }));
  const materials = loadMaterials(db)
    .filter((m) => m.kind === "fiber")
    .map((m) => ({ key: m.key, name: m.name }));
  const pricingSettings = loadPricingSettings(db);
  const defaultBps = pricingSettings.defaultAllowedBps;
  const usage = lookupUsage(db);
  const retail = retailDepsFor(source);
  const lookups = recentLookups(db, 8);
  const monthLabel = new Date(`${usage.month}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const defaultPercent = defaultBps / 100;
  const deals = getDealsByPctOfRetail(db, source);
  const enabledCategoryIds = new Set(categoryRows.filter((c) => c.enabled).map((c) => c.id));
  const enabledBrandIds = new Set(brandRows.filter((b) => b.enabled).map((b) => b.id));
  const gridMode = sp.rules === "grid";
  const gridCells: Record<string, GridValue> = Object.fromEntries(
    rules
      .filter((r) => r.materialKey === null) // the grid holds the general (any-material) prices
      .map((r) => [
        `${r.categoryId}_${r.brandId ?? "all"}`,
        { retail: minorToInput(r.referenceRetailMinor), percent: r.allowedBps === null ? "" : formatBps(r.allowedBps).replace("%", ""), active: r.active },
      ]),
  );
  const lists = Object.fromEntries(LISTS.map((l) => [l.key, getPricingList(db, source, l.key, { onlyRelevant: !includeAll, limit: l.key === list ? 200 : 0 })])) as Record<
    PricingFilter,
    ReturnType<typeof getPricingList>
  >;
  const current = lists[list];
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    if (sp.list && typeof sp.list === "string") p.set("list", sp.list);
    if (sp.scope && typeof sp.scope === "string") p.set("scope", sp.scope);
    if (sp.rules && typeof sp.rules === "string") p.set("rules", sp.rules);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const s = p.toString();
    return s ? `/cost?${s}` : "/cost";
  };

  return (
    <>
      <DealsSlider items={deals} defaultPercent={defaultPercent} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {LISTS.map((l) => (
          <Link key={l.key} href={qs({ list: l.key })} scroll={false} className={cn("card p-5 transition hover:border-line-strong", list === l.key && "border-ink")}>
            <p className="eyebrow">{l.label}</p>
            <p className="mt-2 font-display text-4xl font-semibold tabular">{lists[l.key].count.toLocaleString()}</p>
            <p className="mt-1 text-xs text-ink-3">{includeAll ? "All stored listings" : "Matches & needs-review listings"}</p>
          </Link>
        ))}
      </div>

      <section className="space-y-4">
        <SectionTitle
          id="rules"
          title="Pricing rules"
          description={
            <>
              Where a listing&apos;s new price comes from, first match wins: <strong className="font-semibold text-ink">1.</strong> your price for that listing →{" "}
              <strong className="font-semibold text-ink">2.</strong> your brand + material rule (e.g. Brunello Cucinelli cashmere sweaters) → <strong className="font-semibold text-ink">3.</strong> your brand rule →{" "}
              <strong className="font-semibold text-ink">4.</strong> a typical new price found online (below) → <strong className="font-semibold text-ink">5.</strong> your category + material rule →{" "}
              <strong className="font-semibold text-ink">6.</strong> your category-wide rule. The app never invents prices. Leave a % blank to use your default ({defaultPercent}%). Changes recalculate stored listings immediately, without a new scan.
            </>
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-full border border-line bg-surface p-0.5 text-[13px] font-medium">
            <Link href={qs({ rules: null })} scroll={false} className={cn("rounded-full px-3 py-1", !gridMode ? "bg-ink text-white" : "text-ink-2 hover:text-ink")}>
              Rules list
            </Link>
            <Link href={qs({ rules: "grid" })} scroll={false} className={cn("rounded-full px-3 py-1", gridMode ? "bg-ink text-white" : "text-ink-2 hover:text-ink")}>
              Brand × category grid
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[13px] font-medium">
            <a href="/api/pricing-rules" className="text-ink-2 underline-offset-4 hover:text-ink hover:underline">
              Download rules (CSV)
            </a>
            <a href="/api/pricing-rules?template=1" className="text-ink-2 underline-offset-4 hover:text-ink hover:underline">
              Download fill-in template
            </a>
          </div>
        </div>
        <div className="card p-4">
          <CsvImportForm />
        </div>
        {gridMode ? (
          <RuleGrid
            categories={categories.filter((c) => enabledCategoryIds.has(c.id))}
            brands={brands.filter((b) => enabledBrandIds.has(b.id))}
            cells={gridCells}
            defaultPercent={String(defaultPercent)}
          />
        ) : (
        <div className="card overflow-hidden">
          {rules.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-line bg-canvas text-xs text-ink-3">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Scope</th>
                    <th className="px-4 py-2.5 font-semibold">Reference retail</th>
                    <th className="px-4 py-2.5 font-semibold">Retail source</th>
                    <th className="px-4 py-2.5 font-semibold">Allowed</th>
                    <th className="px-4 py-2.5 font-semibold">Max secondhand</th>
                    <th className="px-4 py-2.5 font-semibold">Active</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rules.map((r) => (
                    <ExpandableRow
                      key={r.id}
                      colSpan={7}
                      className={cn(!r.active && "opacity-55")}
                      cells={
                        <>
                          <td className="px-4 py-3">
                            <p className="font-medium text-ink">{r.categoryName}</p>
                            <p className="text-xs text-ink-3">
                              {r.brandName ?? "All brands — category-wide"}
                              {r.materialName ? ` · only ${r.materialName.toLowerCase()}` : ""}
                            </p>
                          </td>
                          <td className="px-4 py-3 tabular">{formatMoney(r.referenceRetailMinor, r.currency)}</td>
                          <td className="max-w-48 px-4 py-3 text-ink-2">{r.retailSource ?? <span className="text-ink-3">—</span>}</td>
                          <td className="px-4 py-3 tabular">
                            {formatBps(r.effectiveBps)}
                            {r.allowedBps === null ? <span className="block text-xs text-ink-3">your default</span> : null}
                          </td>
                          <td className="px-4 py-3 font-semibold tabular">{formatMoney(r.maxPriceMinor, r.currency)}</td>
                          <td className="px-4 py-3">
                            <Toggle checked={r.active} onChange={toggleRuleAction.bind(null, r.id)} label={`Rule active: ${r.categoryName} ${r.brandName ?? ""}`} size="sm" />
                          </td>
                        </>
                      }
                      editor={
                        <div className="space-y-3">
                          <RuleForm
                            mode="edit"
                            categories={categories}
                            brands={brands}
                            materials={materials}
                            defaultPercent={defaultPercent}
                            initial={{
                              id: r.id,
                              categoryId: r.categoryId,
                              brandId: r.brandId,
                              materialKey: r.materialKey,
                              retail: minorToInput(r.referenceRetailMinor),
                              percent: r.allowedBps === null ? "" : formatBps(r.allowedBps).replace("%", ""),
                              retailSource: r.retailSource,
                              notes: r.notes,
                              active: r.active,
                            }}
                          />
                          <ActionButton action={deleteRuleAction.bind(null, r.id)} confirm="Delete this pricing rule? Listings will be recalculated." variant="danger" icon="trash">
                            Delete rule
                          </ActionButton>
                        </div>
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-5 py-8 text-center">
              <p className="font-display text-xl font-semibold">No pricing rules yet</p>
              <p className="mx-auto mt-1 max-w-lg text-sm text-ink-2">
                Until a new price applies, listings stay in “Needs pricing review”. Add brand prices in the grid or by CSV, set a price on a listing, or use a seller&apos;s stated retail. Material rules (e.g. cashmere vs cotton sweaters) refine a brand&apos;s price.
              </p>
            </div>
          )}
          <div className="border-t border-line bg-canvas/60 p-4">
            <p className="mb-3 text-sm font-semibold text-ink">Add a rule</p>
            <RuleForm mode="create" categories={categories} brands={brands} materials={materials} defaultPercent={defaultPercent} />
          </div>
        </div>
        )}
      </section>

      <section className="space-y-4">
        <SectionTitle
          id="online"
          title="Online new prices"
          description="When no price of yours covers a kind of item, scans look up its typical new price: one search per kind of item (brand, “men's”, material and garment words — never the eBay listing's text), a few store pages read for their listed price, and the middle price of at least two stores. Resale and marketplace sites never count, prices are USD only, and results are kept for 30 days. Your own prices always win."
        />
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Search service</p>
              <p className="mt-1 text-sm font-medium text-ink">
                {retail.provider ? retail.provider.label : "Not set up"}
                {!pricingSettings.onlineLookups ? <span className="ml-2 text-ink-3">(turned off)</span> : null}
              </p>
              {retail.provider?.id === "fixture" ? (
                <p className="mt-0.5 max-w-xl text-xs text-ink-3">Fixture mode: lookups use sample stores ending in “.example” with sample prices, never real stores.</p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="eyebrow">This month ({monthLabel})</p>
              <p className="mt-1 font-display text-2xl font-semibold tabular">
                {usage.used.toLocaleString()} <span className="text-base font-normal text-ink-3">of {usage.cap.toLocaleString()} lookups</span>
              </p>
              <p className="text-xs text-ink-3 tabular">{usage.remaining.toLocaleString()} left · resets on the 1st</p>
            </div>
          </div>
          {!retail.provider ? (
            <ol className="list-decimal space-y-1 rounded-lg bg-canvas py-3 pr-4 pl-8 text-sm text-ink-2">
              <li>
                Create a Brave Search API account (<a className="underline underline-offset-2" href="https://brave.com/search/api/" target="_blank" rel="noopener noreferrer">brave.com/search/api</a>) and pick the
                Search plan. Its $5 monthly credit covers about 1,000 searches; Brave asks for a card but doesn&apos;t charge it within the credit.
              </li>
              <li>Create an API key in the Brave dashboard.</li>
              <li>
                Add <code className="rounded bg-muted px-1">BRAVE_SEARCH_API_KEY=…</code> to <code className="rounded bg-muted px-1">.env.local</code> and restart the app. Test it with{" "}
                <code className="rounded bg-muted px-1">npm run retail:check -- &quot;Brunello Cucinelli men&apos;s cashmere cardigan&quot;</code>.
              </li>
            </ol>
          ) : null}
          {lookups.length ? (
            <ul className="divide-y divide-line rounded-xl border border-line text-sm">
              {lookups.map((lk) => (
                <li key={lk.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                  <span className="text-ink-2">“{lk.query}”</span>
                  <span className={cn("tabular", lk.status === "found" ? "text-ink" : "text-ink-3")}>
                    {lk.status === "found"
                      ? `${formatMoney(lk.typicalMinor)} · ${lk.sourceCount} stores`
                      : lk.status === "insufficient"
                        ? "not enough store prices"
                        : "lookup failed"}
                    <span className="ml-2 text-xs text-ink-3">{timeAgo(lk.fetchedAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">No lookups yet. They happen during scans, or from a listing&apos;s Cost section.</p>
          )}
          <details className="rounded-lg border border-line px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-ink select-none">Settings</summary>
            <div className="mt-3">
              <OnlineLookupSettingsForm settings={pricingSettings} maxCap={MAX_MONTHLY_LOOKUPS} />
            </div>
          </details>
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle
          id="listings"
          title="Listings by price eligibility"
          actions={
            <Link href={qs({ scope: includeAll ? null : "all" })} scroll={false} className="text-[13px] font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline">
              {includeAll ? "Show only matches & review" : "Include “not a match” listings"}
            </Link>
          }
        />
        <div className="flex flex-wrap gap-x-6 border-b border-line">
          {LISTS.map((l) => (
            <TabLink key={l.key} href={qs({ list: l.key })} active={list === l.key} count={lists[l.key].count}>
              {l.label}
            </TabLink>
          ))}
        </div>
        {current.items.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-3">Nothing in this list.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {current.items.map((it) => (
              <li key={it.id} className="flex gap-4 p-4">
                <Link href={`/finder?view=all&listing=${it.id}`} className="block w-16 shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-line sm:w-20">
                  {it.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.imageUrl} alt="" loading="lazy" className="aspect-[4/5] w-full object-cover" />
                  ) : (
                    <div className="aspect-[4/5]" />
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={PRICING_TONE[list]}>{PRICING_LABEL[list]}</Badge>
                    <Badge tone={STATE_TONE[it.state]}>{STATE_LABEL[it.state]}</Badge>
                    {it.source === "fixture" ? <Badge tone="fixture">Fixture</Badge> : null}
                  </div>
                  <p className="mt-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase">{it.brandName ?? "Brand not matched"}</p>
                  <Link href={`/finder?view=all&listing=${it.id}`} className="line-clamp-1 text-sm text-ink-2 hover:text-ink">
                    {it.title}
                  </Link>
                  <p className="mt-1 text-[13px] leading-5 text-ink-2">{it.explanation}</p>
                </div>
                <div className="hidden shrink-0 text-right sm:block">
                  <p className="text-base font-semibold tabular">{formatMoney(it.totalMinor ?? it.priceMinor, it.currency ?? "USD")}</p>
                  <p className="text-xs text-ink-3 tabular">{it.totalMinor !== null ? "total" : shippingText(it.shippingStatus, it.shippingMinor, it.currency)}</p>
                  {it.maxPriceMinor !== null ? <p className="mt-1 text-xs text-ink-3 tabular">max {formatMoney(it.maxPriceMinor)}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
