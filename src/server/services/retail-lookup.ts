import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { ListingSource } from "../../lib/domain/types";
import type { ListingFacts } from "../../lib/matching/engine";
import { formatMoney } from "../../lib/money";
import { pricingMaterialKeys, selectRule } from "../../lib/pricing/engine";
import { aggregateStorePrices, type AggregatedPrice } from "../../lib/retail/aggregate";
import { BraveRetailProvider, readBraveKey } from "../../lib/retail/brave";
import { hostOf, isBlockedHost } from "../../lib/retail/domains";
import { extractPagePrices, pagePrice } from "../../lib/retail/extract";
import { createPageFetcher } from "../../lib/retail/fetch-page";
import { fixturePageFetcher, FixtureRetailProvider } from "../../lib/retail/fixture";
import { RetailLookupError, type PageFetcher, type RetailSearchProvider, type RetailSourcePrice } from "../../lib/retail/types";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import { loadPricingSettings, loadScanSettings } from "./context";
import { loadPricingRules, recomputePricing } from "./evaluation";
import { createPricingRule, updatePricingRule } from "./pricing";
import { ValidationError } from "./preferences";
import { productRefResolver, type ProductRef } from "./retail-keys";

/**
 * Online lookup of typical NEW prices: one search per kind of item, a few store
 * pages read for their structured price, the median of at least two stores.
 * Hard monthly cap on search requests; results cached per kind of item.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FOUND_TTL_MS = 30 * DAY;
const NOT_ENOUGH_TTL_MS = 14 * DAY;
const ERROR_TTL_MS = 6 * HOUR;
const RESULTS_CONSIDERED = 8;
const PAGES_READ = 4;

export interface RetailDeps {
  provider: RetailSearchProvider | null;
  fetcher: PageFetcher;
  /** Pause between search requests (Brave allows about one a second). */
  searchIntervalMs: number;
  /** Why lookups are off, when there's no provider. */
  reason?: string;
}

/** Sample stores for fixture listings; Brave for live listings when a key is set; otherwise off. */
export function retailDepsFor(source: ListingSource, env: Record<string, string | undefined> = process.env): RetailDeps {
  if (source === "fixture") return { provider: new FixtureRetailProvider(), fetcher: fixturePageFetcher, searchIntervalMs: 0 };
  const key = readBraveKey(env);
  if (!key) return { provider: null, fetcher: createPageFetcher(), searchIntervalMs: 0, reason: "Add BRAVE_SEARCH_API_KEY to .env.local to look up new prices online." };
  return { provider: new BraveRetailProvider(key), fetcher: createPageFetcher(), searchIntervalMs: 1100 };
}

// --- Monthly cap ---------------------------------------------------------------------------

export const monthOf = (d: Date) => d.toISOString().slice(0, 7); // calendar month, UTC

export function lookupUsage(db: AppDb, now = new Date()) {
  const month = monthOf(now);
  const used = db.select().from(s.retailLookupUsage).where(eq(s.retailLookupUsage.month, month)).get()?.requests ?? 0;
  const cap = loadPricingSettings(db).monthlyLookupCap;
  return { month, used, cap, remaining: Math.max(0, cap - used) };
}

/** Counts one search request against this month's cap — checked and counted in one transaction. False at the cap. */
export function reserveLookup(db: AppDb, now = new Date()): boolean {
  const cap = loadPricingSettings(db).monthlyLookupCap;
  const month = monthOf(now);
  return db.transaction((tx) => {
    const used = tx.select().from(s.retailLookupUsage).where(eq(s.retailLookupUsage.month, month)).get()?.requests ?? 0;
    if (used >= cap) return false;
    tx.insert(s.retailLookupUsage)
      .values({ month, requests: used + 1 })
      .onConflictDoUpdate({ target: s.retailLookupUsage.month, set: { requests: used + 1 } })
      .run();
    return true;
  });
}

// --- One lookup ------------------------------------------------------------------------------

export type LookupRow = typeof s.retailLookups.$inferSelect;
export type LookupOutcome = { kind: "done"; row: LookupRow } | { kind: "cap_reached" };

function saveLookup(db: AppDb, ref: ProductRef, provider: string, agg: Pick<AggregatedPrice, "status" | "typicalMinor" | "minMinor" | "maxMinor" | "sources" | "message"> | { status: "error"; message: string }, now: Date, ttlMs: number): LookupRow {
  const values = {
    productKey: ref.productKey,
    brandId: ref.brandId,
    categoryId: ref.categoryId,
    garmentType: ref.garmentType,
    materialKey: ref.materialKey,
    query: ref.query,
    provider,
    status: agg.status,
    typicalMinor: "typicalMinor" in agg ? agg.typicalMinor : null,
    minMinor: "minMinor" in agg ? agg.minMinor : null,
    maxMinor: "maxMinor" in agg ? agg.maxMinor : null,
    currency: "USD",
    sourceCount: "sources" in agg && agg.status === "found" ? agg.sources.length : 0,
    sources: "sources" in agg ? agg.sources : [],
    message: agg.message,
    fetchedAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  };
  return db.insert(s.retailLookups).values(values).onConflictDoUpdate({ target: s.retailLookups.productKey, set: values }).returning().get();
}

/** Search once for this kind of item, read a few store pages, and store the typical new price (or why not). */
export async function lookUpProduct(db: AppDb, deps: RetailDeps, ref: ProductRef, now = new Date()): Promise<LookupOutcome> {
  if (!deps.provider) throw new RetailLookupError("not_configured", deps.reason ?? "Online lookups aren't set up.");
  if (!reserveLookup(db, now)) return { kind: "cap_reached" };
  const settings = loadPricingSettings(db);
  let results;
  try {
    results = await deps.provider.search(ref.query);
  } catch (err) {
    const row = saveLookup(db, ref, deps.provider.id, { status: "error", message: err instanceof Error ? err.message : "Search failed." }, now, ERROR_TTL_MS);
    if (err instanceof RetailLookupError && (err.code === "auth" || err.code === "rate_limited")) throw err;
    return { kind: "done", row };
  }
  const sample = deps.provider.id === "fixture";
  const prices: RetailSourcePrice[] = [];
  let pagesRead = 0;
  for (const r of results.slice(0, RESULTS_CONSIDERED)) {
    const domain = hostOf(r.url);
    if (!domain || isBlockedHost(domain, settings.blockedDomains)) continue;
    let price = r.offers?.length ? pagePrice(r.offers) : null;
    if (!price && pagesRead < PAGES_READ) {
      pagesRead++;
      const page = await deps.fetcher.fetchPage(r.url);
      if (page.ok && page.html) price = pagePrice(extractPagePrices(page.html));
    }
    if (price) prices.push({ url: r.url, domain, title: r.title.slice(0, 200), priceMinor: price.priceMinor, currency: price.currency, kind: price.kind, ...(sample ? { sample: true } : {}) });
  }
  const agg = aggregateStorePrices(prices);
  return { kind: "done", row: saveLookup(db, ref, deps.provider.id, agg, now, agg.status === "found" ? FOUND_TTL_MS : NOT_ENOUGH_TTL_MS) };
}

// --- Which kinds of item to look up ------------------------------------------------------------

/**
 * Kinds of item among your matches and needs-review listings (in the listing window,
 * not dismissed) that no price of yours covers and that weren't looked up recently —
 * the ones with the most listings first.
 */
export function lookupCandidates(db: AppDb, source: ListingSource, now = new Date()): Array<ProductRef & { listings: number }> {
  const kindOf = productRefResolver(db);
  const rules = loadPricingRules(db);
  const overrides = new Set(db.select({ source: s.priceOverrides.source, id: s.priceOverrides.externalId }).from(s.priceOverrides).all().map((o) => `${o.source}:${o.id}`));
  const fresh = new Set(
    db
      .select({ key: s.retailLookups.productKey })
      .from(s.retailLookups)
      .where(gt(s.retailLookups.expiresAt, now))
      .all()
      .map((r) => r.key),
  );
  const windowStart = now.getTime() - loadScanSettings(db).maxListingAgeDays * DAY;
  const rows = db
    .select({ l: s.listings, e: s.listingEvaluations })
    .from(s.listings)
    .innerJoin(s.listingEvaluations, eq(s.listingEvaluations.listingId, s.listings.id))
    .leftJoin(s.listingUserStates, and(eq(s.listingUserStates.source, s.listings.source), eq(s.listingUserStates.externalId, s.listings.externalId)))
    .where(
      and(
        eq(s.listings.source, source),
        inArray(s.listingEvaluations.state, ["match", "review"]),
        sql`coalesce(${s.listingUserStates.dismissed}, 0) = 0`,
        sql`coalesce(${s.listings.originAt}, ${s.listings.listedAt}, ${s.listings.firstSeenAt}) >= ${windowStart}`,
      ),
    )
    .all();
  const byKey = new Map<string, ProductRef & { listings: number }>();
  for (const { l, e } of rows) {
    if (overrides.has(`${l.source}:${l.externalId}`)) continue;
    const ref = kindOf(l.title, e);
    if (!ref || fresh.has(ref.productKey)) continue;
    const yours = selectRule({ brandId: e.brandId, categoryId: e.categoryId, materialKeys: pricingMaterialKeys((e.facts as ListingFacts | null)?.materialReading) }, rules, null);
    if (yours && (yours.level === "brand_category" || yours.level === "brand_category_material")) continue;
    const current = byKey.get(ref.productKey);
    if (current) current.listings++;
    else byKey.set(ref.productKey, { ...ref, listings: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.listings - a.listings);
}

export interface LookupRunSummary {
  looked: number;
  found: number;
  capReached: boolean;
  /** Set when lookups stopped early (e.g. the key was rejected). */
  stopped: string | null;
}

/** Look up new prices for up to `limit` kinds of item, within the monthly cap, then re-price listings. */
export async function runRetailLookups(db: AppDb, deps: RetailDeps, opts: { source: ListingSource; limit: number; now?: Date }): Promise<LookupRunSummary> {
  const out: LookupRunSummary = { looked: 0, found: 0, capReached: false, stopped: null };
  if (!loadPricingSettings(db).onlineLookups || !deps.provider || opts.limit <= 0) return out;
  const now = opts.now ?? new Date();
  for (const ref of lookupCandidates(db, opts.source, now).slice(0, opts.limit)) {
    if (out.looked > 0 && deps.searchIntervalMs > 0) await new Promise((r) => setTimeout(r, deps.searchIntervalMs));
    try {
      const result = await lookUpProduct(db, deps, ref, now);
      if (result.kind === "cap_reached") {
        out.capReached = true;
        break;
      }
      out.looked++;
      if (result.row.status === "found") out.found++;
    } catch (err) {
      out.stopped = err instanceof Error ? err.message : "Online lookups stopped.";
      break;
    }
  }
  if (out.looked) recomputePricing(db);
  return out;
}

// --- From the listing view -----------------------------------------------------------------------

/** "Look up new price" for one listing's kind of item (counts against the monthly cap). */
export async function lookUpListing(db: AppDb, deps: RetailDeps, listingId: number, now = new Date()): Promise<string> {
  const row = db
    .select({ l: s.listings, e: s.listingEvaluations })
    .from(s.listings)
    .innerJoin(s.listingEvaluations, eq(s.listingEvaluations.listingId, s.listings.id))
    .where(eq(s.listings.id, listingId))
    .get();
  if (!row) throw new ValidationError("Listing not found.");
  const ref = productRefResolver(db)(row.l.title, row.e);
  if (!ref) throw new ValidationError("The brand and category must be known before the new price can be looked up.");
  let result: LookupOutcome;
  try {
    result = await lookUpProduct(db, deps, ref, now);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : "Lookup failed.");
  }
  if (result.kind === "cap_reached") {
    throw new ValidationError(`All ${lookupUsage(db, now).cap.toLocaleString()} lookups for this month are used; they start again on the 1st.`);
  }
  recomputePricing(db);
  const r = result.row;
  if (r.status === "found") return `Found a typical new price of ${formatMoney(r.typicalMinor)} across ${r.sourceCount} stores (“${r.query}”).`;
  return r.message ?? "No usable prices were found.";
}

/** Save a found online price as your own price for that brand + category (+ material). */
export function saveOnlinePriceAsRule(db: AppDb, lookupId: number): string {
  const lk = db.select().from(s.retailLookups).where(eq(s.retailLookups.id, lookupId)).get();
  if (!lk || lk.status !== "found" || lk.typicalMinor === null) throw new ValidationError("There's no online price to use.");
  const source = `Online: median of ${lk.sourceCount} stores, ${lk.fetchedAt.toISOString().slice(0, 10)}${lk.provider === "fixture" ? " (sample data)" : ""}`;
  const existing = db
    .select()
    .from(s.pricingRules)
    .where(
      and(
        eq(s.pricingRules.categoryId, lk.categoryId),
        eq(s.pricingRules.brandId, lk.brandId),
        lk.materialKey === null ? isNull(s.pricingRules.materialKey) : eq(s.pricingRules.materialKey, lk.materialKey),
      ),
    )
    .get();
  if (existing) updatePricingRule(db, existing.id, { referenceRetailMinor: lk.typicalMinor, retailSource: source });
  else createPricingRule(db, { categoryId: lk.categoryId, brandId: lk.brandId, materialKey: lk.materialKey, referenceRetailMinor: lk.typicalMinor, allowedBps: null, retailSource: source });
  return `Saved ${formatMoney(lk.typicalMinor)} as your price. Listings recalculated.`;
}

/** The most recent lookups, newest first (for the Cost page). */
export function recentLookups(db: AppDb, limit = 10): LookupRow[] {
  return db.select().from(s.retailLookups).orderBy(sql`${s.retailLookups.fetchedAt} desc`).limit(limit).all();
}
