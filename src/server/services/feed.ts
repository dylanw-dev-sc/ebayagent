import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { ListingSource, MatchState } from "../../lib/domain/types";
import type { ListingFacts, Reason } from "../../lib/matching/engine";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import { loadPricingSettings, loadScanSettings } from "./context";
import { productRefResolver } from "./retail-keys";
import { lookupUsage, retailDepsFor } from "./retail-lookup";
import { getPriceOverride } from "./pricing";

export type FeedView = "matches" | "review" | "excluded" | "all" | "saved" | "dismissed";
export type FeedSort = "newest" | "price_asc" | "price_desc" | "pct" | "material" | "color";
export type PricingFilter = "eligible" | "over_ceiling" | "needs_review";

export interface FeedFilters {
  view: FeedView;
  brandId?: number;
  categoryId?: number;
  size?: string;
  material?: string;
  color?: string;
  pricing?: PricingFilter;
  review?: "unreviewed" | "reviewed";
  profileId?: number;
  q?: string;
  /** Only listings first seen after `newSince`. */
  newOnly?: boolean;
  /** Listings first seen after this are "new since your last visit" (null = no badges). */
  newSince?: Date | null;
  sort: FeedSort;
  page: number;
  pageSize: number;
}

export interface FeedItem {
  id: number;
  source: ListingSource;
  externalId: string;
  title: string;
  imageUrl: string | null;
  itemUrl: string | null;
  brandName: string | null;
  brandStatus: string;
  categoryName: string | null;
  sizeLabel: string | null;
  materialSummary: string;
  materialLevel: string;
  /** e.g. "Navy, White" (null when the listing names no color). */
  colorSummary: string | null;
  conditionLabel: string | null;
  priceMinor: number | null;
  currency: string | null;
  shippingStatus: string;
  shippingMinor: number | null;
  totalMinor: number | null;
  isAuction: boolean;
  state: MatchState;
  summary: string;
  matchedProfileNames: string[];
  reviewProfileNames: string[];
  pricingStatus: "eligible" | "over_ceiling" | "needs_review" | null;
  pricingExplanation: string | null;
  maxPriceMinor: number | null;
  /** Total ÷ reference new price (basis points, rounded up); null when there's no reference price. */
  pctOfRetailBps: number | null;
  /** Shipping unknown: the % covers the item price only. */
  pctIsLowerBound: boolean;
  saved: boolean;
  dismissed: boolean;
  reviewed: boolean;
  listedAt: Date | null;
  lastSeenAt: Date;
  stale: boolean;
  /** Counterfeit red-flag phrases found (shown even when your policy only flags). */
  redFlags: string[];
  /** First seen since your last visit to the Finder. */
  isNew: boolean;
}

const VIEW_STATE: Partial<Record<FeedView, MatchState>> = { matches: "match", review: "review", excluded: "no_match" };

/** When a listing was posted: eBay's original listing date, falling back to creation / first seen. */
const postedAt = sql`coalesce(${s.listings.originAt}, ${s.listings.listedAt}, ${s.listings.firstSeenAt})`;

export function listingWindowStart(db: AppDb, now = Date.now()): Date {
  return new Date(now - Math.max(1, loadScanSettings(db).maxListingAgeDays) * 86_400_000);
}

function baseConditions(f: Omit<FeedFilters, "view" | "sort" | "page" | "pageSize">, source: ListingSource, view: FeedView, windowStart: Date): SQL[] {
  const c: SQL[] = [eq(s.listings.source, source)];
  // Saved and Dismissed show everything you marked; the other views show only the listing-age window.
  if (view !== "saved" && view !== "dismissed") c.push(sql`${postedAt} >= ${windowStart.getTime()}`);
  const dismissed = sql`coalesce(${s.listingUserStates.dismissed}, 0)`;
  const state = VIEW_STATE[view];
  if (state) c.push(eq(s.listingEvaluations.state, state), sql`${dismissed} = 0`);
  if (view === "all") c.push(sql`${dismissed} = 0`);
  if (view === "saved") c.push(sql`coalesce(${s.listingUserStates.saved}, 0) = 1`);
  if (view === "dismissed") c.push(sql`${dismissed} = 1`);
  if (f.brandId) c.push(eq(s.listingEvaluations.brandId, f.brandId));
  if (f.categoryId) c.push(eq(s.listingEvaluations.categoryId, f.categoryId));
  if (f.size) c.push(sql`exists (select 1 from json_each(${s.listingEvaluations.sizeKeys}) where value = ${f.size})`);
  if (f.material) c.push(sql`exists (select 1 from json_each(${s.listingEvaluations.materialKeys}) where value = ${f.material})`);
  if (f.color) c.push(sql`exists (select 1 from json_each(${s.listingEvaluations.colorKeys}) where value = ${f.color})`);
  if (f.pricing) c.push(eq(s.pricingDecisions.status, f.pricing));
  if (f.review === "reviewed") c.push(sql`coalesce(${s.listingUserStates.reviewed}, 0) = 1`);
  if (f.review === "unreviewed") c.push(sql`coalesce(${s.listingUserStates.reviewed}, 0) = 0`);
  if (f.profileId) {
    c.push(
      state
        ? sql`exists (select 1 from ${s.listingProfileMatches} m where m.listing_id = ${s.listings.id} and m.profile_id = ${f.profileId} and m.state = ${state})`
        : sql`exists (select 1 from ${s.listingProfileMatches} m where m.listing_id = ${s.listings.id} and m.profile_id = ${f.profileId})`,
    );
  }
  if (f.q?.trim()) c.push(sql`${s.listings.title} like ${"%" + f.q.trim() + "%"}`);
  if (f.newOnly && f.newSince) c.push(sql`${s.listings.firstSeenAt} > ${f.newSince.getTime()}`);
  return c;
}

function feedOrder(f: Pick<FeedFilters, "sort">) {
  const recency = sql`coalesce(${s.listings.originAt}, ${s.listings.listedAt}, ${s.listings.firstSeenAt})`;
  const totalOrItem = sql`coalesce(${s.pricingDecisions.totalMinor}, ${s.listings.priceMinor})`;
  const unknownTotalLast = sql`case when ${s.pricingDecisions.totalMinor} is null then 1 else 0 end`;
  return f.sort === "price_asc"
    ? [asc(unknownTotalLast), asc(totalOrItem), desc(recency), desc(s.listings.id)]
    : f.sort === "price_desc"
      ? [asc(unknownTotalLast), desc(totalOrItem), desc(recency), desc(s.listings.id)]
      : f.sort === "pct" // lowest share of retail first; listings without a reference price last
        ? [asc(sql`case when ${s.pricingDecisions.pctOfRetailBps} is null then 1 else 0 end`), asc(s.pricingDecisions.pctOfRetailBps), desc(recency), desc(s.listings.id)]
      : f.sort === "material" // fabric first; your color preferences break ties
        ? [desc(s.listingEvaluations.materialScore), desc(s.listingEvaluations.colorScore), desc(recency), desc(s.listings.id)]
        : f.sort === "color" // color first; fabric breaks ties
          ? [desc(s.listingEvaluations.colorScore), desc(s.listingEvaluations.materialScore), desc(recency), desc(s.listings.id)]
          : [desc(recency), desc(s.listings.id)];
}

/**
 * Previous / next listing in the current feed order (across pages), for
 * stepping through listings in the detail view.
 */
export function getFeedNeighbors(db: AppDb, f: FeedFilters, source: ListingSource, listingId: number) {
  const conds = baseConditions(f, source, f.view, listingWindowStart(db));
  const ids = db
    .select({ id: s.listings.id })
    .from(s.listings)
    .innerJoin(s.listingEvaluations, eq(s.listingEvaluations.listingId, s.listings.id))
    .leftJoin(s.pricingDecisions, eq(s.pricingDecisions.listingId, s.listings.id))
    .leftJoin(s.listingUserStates, and(eq(s.listingUserStates.source, s.listings.source), eq(s.listingUserStates.externalId, s.listings.externalId)))
    .where(and(...conds))
    .orderBy(...feedOrder(f))
    .all()
    .map((r) => r.id);
  const i = ids.indexOf(listingId);
  if (i < 0) return { index: null, total: ids.length, prev: null, next: null };
  const at = (j: number) => (j >= 0 && j < ids.length ? { id: ids[j], page: Math.floor(j / f.pageSize) + 1 } : null);
  return { index: i, total: ids.length, prev: at(i - 1), next: at(i + 1) };
}

function joined(db: AppDb) {
  return db
    .select({
      l: s.listings,
      e: s.listingEvaluations,
      p: s.pricingDecisions,
      u: s.listingUserStates,
    })
    .from(s.listings)
    .innerJoin(s.listingEvaluations, eq(s.listingEvaluations.listingId, s.listings.id))
    .leftJoin(s.pricingDecisions, eq(s.pricingDecisions.listingId, s.listings.id))
    .leftJoin(s.listingUserStates, and(eq(s.listingUserStates.source, s.listings.source), eq(s.listingUserStates.externalId, s.listings.externalId)));
}

function countFor(db: AppDb, conds: SQL[]): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(s.listings)
    .innerJoin(s.listingEvaluations, eq(s.listingEvaluations.listingId, s.listings.id))
    .leftJoin(s.pricingDecisions, eq(s.pricingDecisions.listingId, s.listings.id))
    .leftJoin(s.listingUserStates, and(eq(s.listingUserStates.source, s.listings.source), eq(s.listingUserStates.externalId, s.listings.externalId)))
    .where(and(...conds))
    .get();
  return Number(row?.n ?? 0);
}

export function getFeed(db: AppDb, f: FeedFilters, source: ListingSource) {
  const staleMs = loadScanSettings(db).staleAfterHours * 3_600_000;
  const now = Date.now();
  const brandNames = new Map(db.select({ id: s.brands.id, name: s.brands.name }).from(s.brands).all().map((b) => [b.id, b.name]));
  const categoryNames = new Map(db.select({ id: s.categories.id, name: s.categories.name }).from(s.categories).all().map((c) => [c.id, c.name]));
  const profileNames = new Map(db.select({ id: s.searchProfiles.id, name: s.searchProfiles.name }).from(s.searchProfiles).all().map((p) => [p.id, p.name]));

  const windowStart = listingWindowStart(db);
  const conds = baseConditions(f, source, f.view, windowStart);
  const order = feedOrder(f);

  const total = countFor(db, conds);
  const rows = joined(db)
    .where(and(...conds))
    .orderBy(...order)
    .limit(f.pageSize)
    .offset(Math.max(0, f.page - 1) * f.pageSize)
    .all();

  const items: FeedItem[] = rows.map(({ l, e, p, u }) => ({
    id: l.id,
    source: l.source,
    externalId: l.externalId,
    title: l.title,
    imageUrl: l.imageUrl,
    itemUrl: l.itemUrl,
    brandName: e.brandId !== null ? brandNames.get(e.brandId) ?? null : null,
    brandStatus: e.brandStatus,
    categoryName: e.categoryId !== null ? categoryNames.get(e.categoryId) ?? null : null,
    sizeLabel: e.sizeLabel,
    materialSummary: e.materialSummary,
    materialLevel: e.materialLevel,
    colorSummary: e.colorSummary,
    conditionLabel: e.conditionLabel,
    priceMinor: l.priceMinor,
    currency: l.currency,
    shippingStatus: l.shippingStatus,
    shippingMinor: l.shippingMinor,
    totalMinor: p?.totalMinor ?? null,
    isAuction: (l.buyingOptions ?? []).includes("AUCTION") && !(l.buyingOptions ?? []).includes("FIXED_PRICE"),
    state: e.state,
    summary: e.summary,
    matchedProfileNames: e.matchedProfileIds.map((id) => profileNames.get(id)).filter((x): x is string => !!x),
    reviewProfileNames: e.reviewProfileIds.map((id) => profileNames.get(id)).filter((x): x is string => !!x),
    pricingStatus: p?.status ?? null,
    pricingExplanation: p?.explanation ?? null,
    maxPriceMinor: p?.maxPriceMinor ?? null,
    pctOfRetailBps: p?.pctOfRetailBps ?? null,
    pctIsLowerBound: p?.pctIsLowerBound ?? false,
    saved: u?.saved ?? false,
    dismissed: u?.dismissed ?? false,
    reviewed: u?.reviewed ?? false,
    listedAt: l.listedAt,
    lastSeenAt: l.lastSeenAt,
    stale: now - l.lastSeenAt.getTime() > staleMs,
    redFlags: (e.facts as ListingFacts | null)?.redFlags ?? [],
    isNew: !!f.newSince && l.firstSeenAt > f.newSince,
  }));

  const nonView = { ...f };
  const counts = {
    matches: countFor(db, baseConditions(nonView, source, "matches", windowStart)),
    review: countFor(db, baseConditions(nonView, source, "review", windowStart)),
    excluded: countFor(db, baseConditions(nonView, source, "excluded", windowStart)),
    saved: countFor(db, baseConditions(nonView, source, "saved", windowStart)),
    dismissed: countFor(db, baseConditions(nonView, source, "dismissed", windowStart)),
  };

  const newCount = f.newSince ? countFor(db, baseConditions({ ...f, newOnly: true }, source, f.view, windowStart)) : 0;

  return { items, total, counts, newCount, page: f.page, pageSize: f.pageSize, windowDays: loadScanSettings(db).maxListingAgeDays };
}

/** Values available for the filter controls (from evaluated listings of this source). */
export function getFeedFacets(db: AppDb, source: ListingSource) {
  const brandRows = db
    .select({ id: s.listingEvaluations.brandId, n: sql<number>`count(*)` })
    .from(s.listingEvaluations)
    .innerJoin(s.listings, eq(s.listings.id, s.listingEvaluations.listingId))
    .where(and(eq(s.listings.source, source), sql`${s.listingEvaluations.brandId} is not null`))
    .groupBy(s.listingEvaluations.brandId)
    .all();
  const brands = new Map(db.select().from(s.brands).all().map((b) => [b.id, b.name]));
  const sizes = db
    .all<{ value: string; n: number }>(
      sql`select j.value as value, count(*) as n from ${s.listingEvaluations} e join ${s.listings} l on l.id = e.listing_id, json_each(e.size_keys) j where l.source = ${source} group by j.value order by j.value`,
    )
    .map((r) => r.value);
  const materialKeys = db
    .all<{ value: string }>(
      sql`select distinct j.value as value from ${s.listingEvaluations} e join ${s.listings} l on l.id = e.listing_id, json_each(e.material_keys) j where l.source = ${source}`,
    )
    .map((r) => r.value);
  const materials = db.select({ key: s.materials.key, name: s.materials.name }).from(s.materials).all();
  const colorKeys = db
    .all<{ value: string }>(
      sql`select distinct j.value as value from ${s.listingEvaluations} e join ${s.listings} l on l.id = e.listing_id, json_each(e.color_keys) j where l.source = ${source}`,
    )
    .map((r) => r.value);
  const colors = db.select({ key: s.colors.key, name: s.colors.name }).from(s.colors).orderBy(asc(s.colors.sortOrder)).all();
  return {
    brands: brandRows
      .map((r) => ({ id: r.id as number, name: brands.get(r.id as number) ?? "Unknown", count: Number(r.n) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    categories: db.select({ id: s.categories.id, name: s.categories.name }).from(s.categories).orderBy(asc(s.categories.sortOrder)).all(),
    sizes,
    materials: materials.filter((m) => materialKeys.includes(m.key)),
    colors: colors.filter((c) => colorKeys.includes(c.key)),
    profiles: db.select({ id: s.searchProfiles.id, name: s.searchProfiles.name }).from(s.searchProfiles).orderBy(asc(s.searchProfiles.sortOrder)).all(),
  };
}

export function getListingDetail(db: AppDb, id: number) {
  const row = joined(db).where(eq(s.listings.id, id)).get();
  if (!row) return null;
  const { l, e, p, u } = row;
  const profiles = db
    .select({ m: s.listingProfileMatches, name: s.searchProfiles.name, enabled: s.searchProfiles.enabled })
    .from(s.listingProfileMatches)
    .innerJoin(s.searchProfiles, eq(s.searchProfiles.id, s.listingProfileMatches.profileId))
    .where(eq(s.listingProfileMatches.listingId, id))
    .orderBy(asc(s.searchProfiles.sortOrder))
    .all()
    .map((r) => ({ profileId: r.m.profileId, name: r.name, state: r.m.state, summary: r.m.summary, reasons: r.m.reasons as Reason[] }));
  const staleMs = loadScanSettings(db).staleAfterHours * 3_600_000;
  const ruleSource = p?.ruleId ? db.select({ src: s.pricingRules.retailSource }).from(s.pricingRules).where(eq(s.pricingRules.id, p.ruleId)).get()?.src ?? null : null;
  const pricingSettings = loadPricingSettings(db);
  // The online lookup for this listing's kind of item: the one in use, or the latest attempt.
  const kind = productRefResolver(db)(l.title, e);
  const lookup =
    (p?.retailLookupId ? db.select().from(s.retailLookups).where(eq(s.retailLookups.id, p.retailLookupId)).get() : undefined) ??
    (kind ? db.select().from(s.retailLookups).where(eq(s.retailLookups.productKey, kind.productKey)).get() : undefined) ??
    null;
  const deps = retailDepsFor(l.source);
  return {
    defaultPercent: pricingSettings.defaultAllowedBps / 100,
    ruleSource,
    online: {
      lookup,
      query: kind?.query ?? null,
      materialName: lookup?.materialKey ? db.select({ name: s.materials.name }).from(s.materials).where(eq(s.materials.key, lookup.materialKey)).get()?.name ?? lookup.materialKey : null,
      canLookUp: kind !== null,
      available: deps.provider !== null && pricingSettings.onlineLookups,
      unavailableReason: !pricingSettings.onlineLookups ? "Online lookups are turned off (Cost Evaluator → Online new prices)." : deps.reason ?? null,
      sample: deps.provider?.id === "fixture",
      remaining: lookupUsage(db).remaining,
    },
    listing: l,
    evaluation: e,
    facts: e.facts as ListingFacts,
    brandName: e.brandId !== null ? db.select({ name: s.brands.name }).from(s.brands).where(eq(s.brands.id, e.brandId)).get()?.name ?? null : null,
    categoryName: e.categoryId !== null ? db.select({ name: s.categories.name }).from(s.categories).where(eq(s.categories.id, e.categoryId)).get()?.name ?? null : null,
    pricing: p,
    userState: u,
    override: getPriceOverride(db, l.source, l.externalId),
    profiles,
    stale: Date.now() - l.lastSeenAt.getTime() > staleMs,
  };
}

/** Lists for the Cost Evaluator: eligible / over ceiling / needs pricing review. */
export function getPricingList(db: AppDb, source: ListingSource, status: PricingFilter, opts: { onlyRelevant: boolean; limit: number }) {
  const conds: SQL[] = [eq(s.listings.source, source), eq(s.pricingDecisions.status, status), sql`${postedAt} >= ${listingWindowStart(db).getTime()}`];
  if (opts.onlyRelevant) conds.push(sql`${s.listingEvaluations.state} in ('match', 'review')`);
  const brandNames = new Map(db.select({ id: s.brands.id, name: s.brands.name }).from(s.brands).all().map((b) => [b.id, b.name]));
  const categoryNames = new Map(db.select({ id: s.categories.id, name: s.categories.name }).from(s.categories).all().map((c) => [c.id, c.name]));
  const rows = joined(db)
    .where(and(...conds))
    .orderBy(desc(sql`coalesce(${s.listings.originAt}, ${s.listings.listedAt}, ${s.listings.firstSeenAt})`))
    .limit(opts.limit)
    .all();
  const count = countFor(db, conds);
  return {
    count,
    items: rows.map(({ l, e, p }) => ({
      id: l.id,
      title: l.title,
      imageUrl: l.imageUrl,
      source: l.source,
      brandName: e.brandId !== null ? brandNames.get(e.brandId) ?? null : null,
      categoryName: e.categoryId !== null ? categoryNames.get(e.categoryId) ?? null : null,
      state: e.state,
      priceMinor: l.priceMinor,
      currency: l.currency,
      shippingStatus: l.shippingStatus,
      shippingMinor: l.shippingMinor,
      totalMinor: p?.totalMinor ?? null,
      maxPriceMinor: p?.maxPriceMinor ?? null,
      referenceRetailMinor: p?.referenceRetailMinor ?? null,
      allowedBps: p?.allowedBps ?? null,
      ruleLevel: p?.ruleLevel ?? null,
      reason: p?.reason ?? null,
      explanation: p?.explanation ?? "",
      pctOfRetailBps: p?.pctOfRetailBps ?? null,
      pctIsLowerBound: p?.pctIsLowerBound ?? false,
    })),
  };
}

/**
 * Matches & needs-review listings (not dismissed, in the listing window) that have a
 * % of retail — lowest share first. Feeds the deals slider, which filters on the client.
 */
export function getDealsByPctOfRetail(db: AppDb, source: ListingSource, opts: { limit?: number } = {}) {
  const conds: SQL[] = [
    eq(s.listings.source, source),
    sql`${postedAt} >= ${listingWindowStart(db).getTime()}`,
    sql`${s.listingEvaluations.state} in ('match', 'review')`,
    sql`coalesce(${s.listingUserStates.dismissed}, 0) = 0`,
    sql`${s.pricingDecisions.pctOfRetailBps} is not null`,
  ];
  const brandNames = new Map(db.select({ id: s.brands.id, name: s.brands.name }).from(s.brands).all().map((b) => [b.id, b.name]));
  const categoryNames = new Map(db.select({ id: s.categories.id, name: s.categories.name }).from(s.categories).all().map((c) => [c.id, c.name]));
  const rows = joined(db)
    .where(and(...conds))
    .orderBy(asc(s.pricingDecisions.pctOfRetailBps), desc(s.listings.id))
    .limit(opts.limit ?? 500)
    .all();
  return rows.map(({ l, e, p }) => ({
    id: l.id,
    title: l.title,
    imageUrl: l.imageUrl,
    isFixture: l.source === "fixture",
    brandName: e.brandId !== null ? brandNames.get(e.brandId) ?? null : null,
    categoryName: e.categoryId !== null ? categoryNames.get(e.categoryId) ?? null : null,
    state: e.state,
    totalMinor: p?.totalMinor ?? null,
    priceMinor: l.priceMinor,
    currency: l.currency ?? "USD",
    referenceRetailMinor: p?.referenceRetailMinor ?? null,
    ruleLevel: p?.ruleLevel ?? null,
    pctOfRetailBps: p?.pctOfRetailBps ?? 0,
    pctIsLowerBound: p?.pctIsLowerBound ?? false,
  }));
}
