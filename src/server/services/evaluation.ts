import { eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { evaluateListing, type ListingEvaluation, type ListingForEvaluation } from "../../lib/matching/engine";
import { decidePricing, type PriceOverride, type PricingRule } from "../../lib/pricing/engine";
import { sizeKey } from "../../lib/matching/size";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import { loadEngineContext, type LoadedContext } from "./context";

export type ListingRow = typeof s.listings.$inferSelect;

export function rowToListing(row: ListingRow): ListingForEvaluation {
  return {
    source: row.source,
    externalId: row.externalId,
    legacyId: row.legacyId,
    title: row.title,
    brandAspect: row.brandAspect,
    sizeAspect: row.sizeAspect,
    materialAspect: row.materialAspect,
    aspects: row.aspects ?? [],
    ebayCategoryIds: row.ebayCategoryIds ?? [],
    ebayCategoryPath: row.ebayCategoryPath,
    conditionText: row.conditionText,
    conditionId: row.conditionId,
    priceMinor: row.priceMinor,
    currency: row.currency,
    shippingStatus: row.shippingStatus,
    shippingMinor: row.shippingMinor,
    shippingCurrency: row.shippingCurrency,
    buyingOptions: row.buyingOptions ?? [],
    imageUrl: row.imageUrl,
    additionalImageUrls: row.additionalImages ?? [],
    itemUrl: row.itemUrl,
    listedAt: row.listedAt,
    originAt: row.originAt,
    detailsFetched: !!row.detailsFetchedAt,
    description: row.descriptionText ?? null,
    queryCategoryIds: row.queryCategoryIds ?? [],
  };
}

function persistEvaluation(db: AppDb, listingId: number, ev: ListingEvaluation, rulesHash: string, now: Date): void {
  const f = ev.facts;
  const values = {
    listingId,
    state: ev.state,
    summary: ev.summary,
    brandId: f.brand.brandId,
    brandStatus: f.brand.status,
    categoryId: f.category.categoryId,
    sizeLabel: f.size.values.length ? f.size.values.map(sizeKey).join(" / ") : null,
    sizeKeys: f.size.values.map(sizeKey),
    materialKeys: f.material.keys,
    materialLevel: f.material.level,
    materialSummary: f.material.summary,
    materialScore: ev.materialScore,
    colorKeys: f.color?.keys ?? [],
    colorSummary: f.color?.names.length ? f.color.names.join(", ") : null,
    colorScore: ev.colorScore,
    conditionKey: f.condition.key,
    conditionLabel: f.condition.label,
    matchedProfileIds: ev.matchedProfileIds,
    reviewProfileIds: ev.reviewProfileIds,
    facts: f,
    rulesHash,
    evaluatedAt: now,
  };
  db.insert(s.listingEvaluations)
    .values(values)
    .onConflictDoUpdate({ target: s.listingEvaluations.listingId, set: values })
    .run();
  db.delete(s.listingProfileMatches).where(eq(s.listingProfileMatches.listingId, listingId)).run();
  for (const p of ev.profiles) {
    db.insert(s.listingProfileMatches)
      .values({ listingId, profileId: p.profileId, state: p.state, summary: p.summary, reasons: p.reasons })
      .run();
  }
}

/**
 * Re-run the matching engine. With `onlyStale`, listings already evaluated
 * under the current rules are skipped (no repeated work for unchanged data).
 */
export function reevaluateListings(
  db: AppDb,
  opts: { listingIds?: number[]; onlyStale?: boolean; context?: LoadedContext } = {},
): { evaluated: number; skipped: number; results: Map<number, ListingEvaluation> } {
  const ctx = opts.context ?? loadEngineContext(db);
  const now = new Date();
  const results = new Map<number, ListingEvaluation>();
  let skipped = 0;

  let rows: ListingRow[];
  if (opts.listingIds) {
    if (opts.listingIds.length === 0) return { evaluated: 0, skipped: 0, results };
    rows = [];
    for (let i = 0; i < opts.listingIds.length; i += 500) {
      rows.push(...db.select().from(s.listings).where(inArray(s.listings.id, opts.listingIds.slice(i, i + 500))).all());
    }
  } else if (opts.onlyStale) {
    rows = db
      .select({ l: s.listings })
      .from(s.listings)
      .leftJoin(s.listingEvaluations, eq(s.listingEvaluations.listingId, s.listings.id))
      .where(or(isNull(s.listingEvaluations.listingId), ne(s.listingEvaluations.rulesHash, ctx.rulesHash)))
      .all()
      .map((r) => r.l);
    const total = db.select({ n: sql<number>`count(*)` }).from(s.listings).get()?.n ?? 0;
    skipped = total - rows.length;
  } else {
    rows = db.select().from(s.listings).all();
  }

  db.transaction((tx) => {
    for (const row of rows) {
      const ev = evaluateListing(rowToListing(row), ctx.engine);
      persistEvaluation(tx as unknown as AppDb, row.id, ev, ctx.rulesHash, now);
      results.set(row.id, ev);
    }
  });
  return { evaluated: rows.length, skipped, results };
}

export function loadPricingRules(db: AppDb): PricingRule[] {
  return db
    .select()
    .from(s.pricingRules)
    .all()
    .map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      brandId: r.brandId,
      referenceRetailMinor: r.referenceRetailMinor,
      currency: r.currency,
      allowedBps: r.allowedBps,
      retailSource: r.retailSource,
      active: r.active,
    }));
}

/** Recalculate Cost Evaluator decisions from stored listing data — no API calls. */
export function recomputePricing(db: AppDb, opts: { listingIds?: number[] } = {}): { decided: number } {
  const rules = loadPricingRules(db);
  const brandNames = new Map(db.select({ id: s.brands.id, name: s.brands.name }).from(s.brands).all().map((b) => [b.id, b.name]));
  const categoryNames = new Map(db.select({ id: s.categories.id, name: s.categories.name }).from(s.categories).all().map((c) => [c.id, c.name]));
  const overrides = new Map(
    db
      .select()
      .from(s.priceOverrides)
      .all()
      .map((o) => [`${o.source}:${o.externalId}`, o]),
  );
  const names = {
    brandName: (id: number | null) => (id === null ? null : brandNames.get(id) ?? null),
    categoryName: (id: number | null) => (id === null ? null : categoryNames.get(id) ?? null),
  };

  const query = db
    .select({ l: s.listings, e: s.listingEvaluations })
    .from(s.listings)
    .leftJoin(s.listingEvaluations, eq(s.listingEvaluations.listingId, s.listings.id));
  const rows =
    opts.listingIds !== undefined
      ? opts.listingIds.length
        ? query.where(inArray(s.listings.id, opts.listingIds)).all()
        : []
      : query.all();

  const now = new Date();
  db.transaction((tx) => {
    for (const { l, e } of rows) {
      const o = overrides.get(`${l.source}:${l.externalId}`);
      const override: PriceOverride | null = o
        ? { referenceRetailMinor: o.referenceRetailMinor, allowedBps: o.allowedBps, currency: o.currency, retailSource: o.retailSource }
        : null;
      const d = decidePricing(
        {
          priceMinor: l.priceMinor,
          currency: l.currency,
          shippingStatus: l.shippingStatus,
          shippingMinor: l.shippingMinor,
          shippingCurrency: l.shippingCurrency,
          isAuction: (l.buyingOptions ?? []).includes("AUCTION") && !(l.buyingOptions ?? []).includes("FIXED_PRICE"),
          brandId: e?.brandId ?? null,
          categoryId: e?.categoryId ?? null,
        },
        rules,
        override,
        names,
      );
      const values = { listingId: l.id, ...d, evaluatedAt: now };
      tx.insert(s.pricingDecisions).values(values).onConflictDoUpdate({ target: s.pricingDecisions.listingId, set: values }).run();
    }
  });
  return { decided: rows.length };
}

/** Re-run matching for stale listings, then pricing for everything. */
export function refreshDerivedData(db: AppDb): { evaluated: number; priced: number } {
  const { evaluated } = reevaluateListings(db, { onlyStale: true });
  const { decided } = recomputePricing(db);
  return { evaluated, priced: decided };
}

export function deleteListingsByIds(db: AppDb, ids: number[]): number {
  if (!ids.length) return 0;
  let n = 0;
  for (let i = 0; i < ids.length; i += 500) {
    n += db.delete(s.listings).where(inArray(s.listings.id, ids.slice(i, i + 500))).run().changes;
  }
  return n;
}

