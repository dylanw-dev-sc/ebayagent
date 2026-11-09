import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
  BuyingOption,
  ColorPriority,
  ItemAspect,
  ListingSource,
  MatchState,
  MaterialPriority,
  ShippingStatus,
  SizeSystem,
} from "../../lib/domain/types";
import type { MeasurementRanges } from "../../lib/matching/measurements";
import type { ProfileOverrides } from "../../lib/profiles/resolve";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);
const jsonList = (name: string) => text(name, { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`);

// --- App metadata & settings ---------------------------------------------------------

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: updatedAt(),
});

// --- Preferences -----------------------------------------------------------------------

export const brandGroups = sqliteTable("brand_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

export const brands = sqliteTable("brands", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  /** Keywords sent to eBay search for this brand (q parameter). */
  searchQuery: text("search_query").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  excludePhrases: jsonList("exclude_phrases"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const brandAliases = sqliteTable(
  "brand_aliases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
  },
  (t) => [uniqueIndex("brand_aliases_normalized_unique").on(t.normalizedAlias), index("brand_aliases_brand_idx").on(t.brandId)],
);

export const brandGroupMembers = sqliteTable(
  "brand_group_members",
  {
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => brandGroups.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.brandId, t.groupId] })],
);

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  noun: text("noun").notNull(),
  description: text("description"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sizeSystem: text("size_system").$type<SizeSystem>().notNull().default("alpha"),
  acceptedSizes: jsonList("accepted_sizes"),
  reviewSizes: jsonList("review_sizes"),
  neckSizes: jsonList("neck_sizes"),
  sleeveLengths: jsonList("sleeve_lengths"),
  ebayCategoryIds: jsonList("ebay_category_ids"),
  titleKeywords: jsonList("title_keywords"),
  excludeKeywords: jsonList("exclude_keywords"),
  /** Your flat garment measurement ranges in inches, e.g. {"chest":{"min":22,"max":23.5}}. */
  measurementRanges: text("measurement_ranges", { mode: "json" }).$type<MeasurementRanges>().notNull().default(sql`'{}'`),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const materials = sqliteTable("materials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").$type<"fiber" | "blend">().notNull().default("fiber"),
  priority: text("priority").$type<MaterialPriority>().notNull().default("neutral"),
  keywords: jsonList("keywords"),
  components: jsonList("components"),
  heavyThresholdPct: integer("heavy_threshold_pct"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Your color preferences (prefer / neutral / avoid / exclude), matched by keywords. */
export const colors = sqliteTable("colors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  priority: text("priority").$type<ColorPriority>().notNull().default("neutral"),
  keywords: jsonList("keywords"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const conditions = sqliteTable("conditions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  ebayConditionIds: jsonList("ebay_condition_ids"),
  matchTerms: jsonList("match_terms"),
  accepted: integer("accepted", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const searchProfiles = sqliteTable("search_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  overrides: text("overrides", { mode: "json" }).$type<ProfileOverrides>().notNull().default(sql`'{}'`),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// --- Listings (external data, normalized) ------------------------------------------------

export const listings = sqliteTable(
  "listings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").$type<ListingSource>().notNull(),
    externalId: text("external_id").notNull(),
    legacyId: text("legacy_id"),
    title: text("title").notNull(),
    brandAspect: text("brand_aspect"),
    sizeAspect: text("size_aspect"),
    materialAspect: text("material_aspect"),
    aspects: text("aspects", { mode: "json" }).$type<ItemAspect[]>().notNull().default(sql`'[]'`),
    ebayCategoryIds: jsonList("ebay_category_ids"),
    ebayCategoryPath: text("ebay_category_path"),
    conditionText: text("condition_text"),
    conditionId: text("condition_id"),
    priceMinor: integer("price_minor"),
    currency: text("currency"),
    shippingStatus: text("shipping_status").$type<ShippingStatus>().notNull().default("unknown"),
    shippingMinor: integer("shipping_minor"),
    shippingCurrency: text("shipping_currency"),
    buyingOptions: text("buying_options", { mode: "json" }).$type<BuyingOption[]>().notNull().default(sql`'[]'`),
    imageUrl: text("image_url"),
    additionalImages: jsonList("additional_images"),
    itemUrl: text("item_url"),
    listedAt: integer("listed_at", { mode: "timestamp_ms" }),
    originAt: integer("origin_at", { mode: "timestamp_ms" }),
    /** App category ids of the searches that found this listing. */
    queryCategoryIds: text("query_category_ids", { mode: "json" }).$type<number[]>().notNull().default(sql`'[]'`),
    detailsFetchedAt: integer("details_fetched_at", { mode: "timestamp_ms" }),
    /** Seller description as plain text (from item details), truncated. */
    descriptionText: text("description_text"),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    /** Last time the source confirmed this listing's data ("last checked"). */
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (t) => [
    uniqueIndex("listings_source_external_unique").on(t.source, t.externalId),
    index("listings_last_seen_idx").on(t.lastSeenAt),
    index("listings_listed_idx").on(t.listedAt),
  ],
);

export const listingEvaluations = sqliteTable(
  "listing_evaluations",
  {
    listingId: integer("listing_id")
      .primaryKey()
      .references(() => listings.id, { onDelete: "cascade" }),
    state: text("state").$type<MatchState>().notNull(),
    summary: text("summary").notNull(),
    brandId: integer("brand_id"),
    brandStatus: text("brand_status").notNull(),
    categoryId: integer("category_id"),
    sizeLabel: text("size_label"),
    sizeKeys: jsonList("size_keys"),
    materialKeys: jsonList("material_keys"),
    materialLevel: text("material_level").notNull(),
    materialSummary: text("material_summary").notNull(),
    materialScore: real("material_score").notNull().default(0),
    colorKeys: jsonList("color_keys"),
    /** e.g. "Navy, White" (null when no color was found). */
    colorSummary: text("color_summary"),
    colorScore: real("color_score").notNull().default(0),
    conditionKey: text("condition_key"),
    conditionLabel: text("condition_label"),
    matchedProfileIds: text("matched_profile_ids", { mode: "json" }).$type<number[]>().notNull().default(sql`'[]'`),
    reviewProfileIds: text("review_profile_ids", { mode: "json" }).$type<number[]>().notNull().default(sql`'[]'`),
    facts: text("facts", { mode: "json" }).notNull(),
    rulesHash: text("rules_hash").notNull(),
    evaluatedAt: integer("evaluated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("listing_evaluations_state_idx").on(t.state), index("listing_evaluations_brand_idx").on(t.brandId)],
);

export const listingProfileMatches = sqliteTable(
  "listing_profile_matches",
  {
    listingId: integer("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    profileId: integer("profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "cascade" }),
    state: text("state").$type<MatchState>().notNull(),
    summary: text("summary").notNull(),
    reasons: text("reasons", { mode: "json" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.profileId] }), index("lpm_profile_state_idx").on(t.profileId, t.state)],
);

/**
 * Saved / dismissed / reviewed state. Keyed by (source, external id) — NOT the
 * listing row id — so the user's decisions survive listing purges required by
 * eBay's data-retention rules and re-apply if the item is discovered again.
 */
export const listingUserStates = sqliteTable(
  "listing_user_states",
  {
    source: text("source").$type<ListingSource>().notNull(),
    externalId: text("external_id").notNull(),
    saved: integer("saved", { mode: "boolean" }).notNull().default(false),
    savedAt: integer("saved_at", { mode: "timestamp_ms" }),
    dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false),
    dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" }),
    reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.source, t.externalId] })],
);

// --- Cost Evaluator ---------------------------------------------------------------------------

export const pricingRules = sqliteTable(
  "pricing_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    brandId: integer("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    referenceRetailMinor: integer("reference_retail_minor").notNull(),
    currency: text("currency").notNull().default("USD"),
    allowedBps: integer("allowed_bps").notNull(),
    retailSource: text("retail_source"),
    notes: text("notes"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("pricing_rules_category_idx").on(t.categoryId)],
);

/** Product-level pricing override, keyed like user state so it survives purges. */
export const priceOverrides = sqliteTable(
  "price_overrides",
  {
    source: text("source").$type<ListingSource>().notNull(),
    externalId: text("external_id").notNull(),
    referenceRetailMinor: integer("reference_retail_minor").notNull(),
    allowedBps: integer("allowed_bps").notNull(),
    currency: text("currency").notNull().default("USD"),
    retailSource: text("retail_source"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.source, t.externalId] })],
);

export const pricingDecisions = sqliteTable(
  "pricing_decisions",
  {
    listingId: integer("listing_id")
      .primaryKey()
      .references(() => listings.id, { onDelete: "cascade" }),
    status: text("status").$type<"eligible" | "over_ceiling" | "needs_review">().notNull(),
    reason: text("reason").notNull(),
    ruleLevel: text("rule_level"),
    ruleId: integer("rule_id"),
    referenceRetailMinor: integer("reference_retail_minor"),
    allowedBps: integer("allowed_bps"),
    maxPriceMinor: integer("max_price_minor"),
    itemMinor: integer("item_minor"),
    shippingMinor: integer("shipping_minor"),
    totalMinor: integer("total_minor"),
    currency: text("currency").notNull(),
    explanation: text("explanation").notNull(),
    evaluatedAt: integer("evaluated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("pricing_decisions_status_idx").on(t.status)],
);

// --- Scanning -----------------------------------------------------------------------------

export interface ScanErrorEntry {
  at: string;
  query: string | null;
  code: string;
  message: string;
}

export const scanRuns = sqliteTable("scan_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  heartbeatAt: integer("heartbeat_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status").$type<"running" | "completed" | "completed_with_errors" | "partial" | "failed" | "interrupted">().notNull(),
  mode: text("mode").$type<"live" | "fixture">().notNull(),
  provider: text("provider").notNull(),
  trigger: text("trigger").notNull().default("manual"),
  queriesPlanned: integer("queries_planned").notNull().default(0),
  queriesCompleted: integer("queries_completed").notNull().default(0),
  apiCalls: integer("api_calls").notNull().default(0),
  detailCalls: integer("detail_calls").notNull().default(0),
  examined: integer("examined").notNull().default(0),
  duplicates: integer("duplicates").notNull().default(0),
  newListings: integer("new_listings").notNull().default(0),
  updatedListings: integer("updated_listings").notNull().default(0),
  unchangedListings: integer("unchanged_listings").notNull().default(0),
  matchedNew: integer("matched_new").notNull().default(0),
  reviewNew: integer("review_new").notNull().default(0),
  rejectedNew: integer("rejected_new").notNull().default(0),
  purged: integer("purged").notNull().default(0),
  /** Listings returned by eBay but posted before the listing-age window (not stored). */
  skippedOld: integer("skipped_old").notNull().default(0),
  /** Listings skipped because the seller's feedback was below your minimum (seller data is never stored). */
  skippedSeller: integer("skipped_seller").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  errors: text("errors", { mode: "json" }).$type<ScanErrorEntry[]>().notNull().default(sql`'[]'`),
  rateLimited: integer("rate_limited", { mode: "boolean" }).notNull().default(false),
  notes: text("notes"),
});

export const queryStates = sqliteTable("query_states", {
  queryKey: text("query_key").primaryKey(),
  description: text("description").notNull(),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
  /** Newest itemOriginDate seen by a fully completed run of this query. */
  watermarkAt: integer("watermark_at", { mode: "timestamp_ms" }),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
});
