import type {
  BrandConfig,
  CategoryConfig,
  ConditionConfig,
  MatchState,
  MaterialConfig,
  NormalizedListing,
  ProfileForEvaluation,
} from "../domain/types";
import { formatMoney } from "../money";
import { containsPhrase, normalizePhrase } from "../text";
import { compileBrandMatcher, detectBrand, type BrandDetection, type BrandMatcher } from "./brand";
import { resolveCategory, resolveCondition, type CategoryResolution, type ConditionResolution } from "./category";
import { assessMaterials, PRIORITY_LABEL, readMaterials, type MaterialAssessment, type MaterialReading } from "./material";
import { combineSizeAndMeasurements, judgeMeasurements, readMeasurements, type MeasurementReading } from "./measurements";
import { DEFAULT_RED_FLAG_PHRASES, findRedFlags, type RedFlagPolicy } from "./red-flags";
import { evaluateSize, readListingSize, type SizeReading } from "./size";

/**
 * Deterministic Product Finder matching engine.
 *
 * Facts (brand, category, size, material, condition) are extracted once per
 * listing; each enabled search profile then judges those facts against its
 * effective settings. Every decision carries human-readable reasons.
 */

export type ReasonEffect = "pass" | "review" | "exclude" | "info";
export type Dimension = "brand" | "authenticity" | "category" | "size" | "condition" | "material" | "keyword" | "price";

export interface Reason {
  dimension: Dimension;
  effect: ReasonEffect;
  message: string;
}

export interface ProfileEvaluation {
  profileId: number;
  profileName: string;
  state: MatchState;
  reasons: Reason[];
  summary: string;
}

export interface ListingFacts {
  brand: BrandDetection & { brandName: string | null };
  category: CategoryResolution & { categoryName: string | null };
  size: SizeReading & { label: string | null };
  materialReading: MaterialReading;
  material: MaterialAssessment;
  condition: ConditionResolution;
  measurements: MeasurementReading;
  /** Counterfeit red-flag phrases found in the title or description. */
  redFlags: string[];
}

export interface ListingEvaluation {
  facts: ListingFacts;
  profiles: ProfileEvaluation[];
  state: MatchState;
  summary: string;
  matchedProfileIds: number[];
  reviewProfileIds: number[];
  materialScore: number;
}

export interface EngineContext {
  brands: BrandConfig[];
  matcher: BrandMatcher;
  categories: CategoryConfig[];
  materials: MaterialConfig[];
  conditions: ConditionConfig[];
  profiles: ProfileForEvaluation[];
  /** Material keys excluded globally (priority "exclude") — used for ranking display. */
  globalExcludedMaterialKeys: string[];
  /** Counterfeit red-flag phrases and what to do when one appears. */
  redFlags: { phrases: string[]; policy: RedFlagPolicy };
}

export function buildEngineContext(
  input: Omit<EngineContext, "matcher" | "globalExcludedMaterialKeys" | "redFlags"> & { redFlags?: EngineContext["redFlags"] },
): EngineContext {
  return {
    ...input,
    redFlags: input.redFlags ?? { phrases: DEFAULT_RED_FLAG_PHRASES, policy: "exclude" },
    matcher: compileBrandMatcher(input.brands),
    globalExcludedMaterialKeys: input.materials.filter((m) => m.priority === "exclude").map((m) => m.key),
  };
}

export interface ListingForEvaluation extends NormalizedListing {
  /** App category ids of the searches that found this listing. */
  queryCategoryIds: number[];
}

const STATE_RANK: Record<MatchState, number> = { match: 2, review: 1, no_match: 0 };

export function extractFacts(listing: ListingForEvaluation, ctx: EngineContext): ListingFacts {
  const brand = detectBrand({ title: listing.title, brandAspect: listing.brandAspect }, ctx.matcher);
  const category = resolveCategory(
    { ebayCategoryIds: listing.ebayCategoryIds, queryCategoryIds: listing.queryCategoryIds, title: listing.title },
    ctx.categories.filter((c) => c.enabled),
  );
  const size = readListingSize({ sizeAspect: listing.sizeAspect, title: listing.title });
  const materialReading = readMaterials(
    { title: listing.title, materialAspect: listing.materialAspect, aspects: listing.aspects, description: listing.description },
    ctx.materials,
  );
  const material = assessMaterials(materialReading, ctx.materials, ctx.globalExcludedMaterialKeys);
  const condition = resolveCondition({ conditionId: listing.conditionId, conditionText: listing.conditionText }, ctx.conditions);
  return {
    brand: { ...brand, brandName: brand.brandId !== null ? ctx.brands.find((b) => b.id === brand.brandId)?.name ?? null : null },
    category: { ...category, categoryName: category.categoryId !== null ? ctx.categories.find((c) => c.id === category.categoryId)?.name ?? null : null },
    size: { ...size, label: size.values.length ? size.raw : null },
    materialReading,
    material,
    condition,
    measurements: readMeasurements({ title: listing.title, description: listing.description }),
    redFlags: findRedFlags({ title: listing.title, description: listing.description }, ctx.redFlags.phrases),
  };
}

/** Words that start generic sentences; anything else (e.g. brand names) keeps its capital. */
const GENERIC_STARTERS = new Set([
  "Seller", "Size", "Condition", "Title", "Contains", "Can't", "Couldn't", "None", "No", "Listing", "Item", "Price",
  "Brand", "Required", "Faux", "Fabric", "Neck", "Sleeve", "Numeric",
]);

function lowerFirst(s: string): string {
  const first = s.split(/\s/)[0] ?? "";
  return GENERIC_STARTERS.has(first) ? s[0].toLowerCase() + s.slice(1) : s;
}

function trimPeriod(s: string): string {
  return s.replace(/[.\s]+$/, "");
}

function upperFirst(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export function evaluateForProfile(listing: ListingForEvaluation, facts: ListingFacts, profile: ProfileForEvaluation, ctx: EngineContext): ProfileEvaluation {
  const s = profile.settings;
  const reasons: Reason[] = [];
  const add = (dimension: Dimension, effect: ReasonEffect, message: string) => reasons.push({ dimension, effect, message });

  // --- Brand -------------------------------------------------------------------
  const b = facts.brand;
  if (b.brandId === null) {
    add("brand", "exclude", b.note);
  } else {
    const brand = ctx.brands.find((x) => x.id === b.brandId);
    const inScope = (id: number) => s.brandIds.includes(id) && !!ctx.brands.find((x) => x.id === id)?.enabled;
    if (!brand) {
      add("brand", "exclude", "Brand no longer exists in Preferences");
    } else if (b.status === "excluded_phrase") {
      add("brand", "exclude", b.note);
    } else if (!brand.enabled) {
      add("brand", "exclude", `${brand.name} is disabled in Preferences`);
    } else if (!s.brandIds.includes(brand.id)) {
      const alt = b.otherBrandIds.find(inScope);
      if (alt !== undefined && (b.status === "conflict" || b.status === "ambiguous")) add("brand", "review", b.note);
      else add("brand", "exclude", `${brand.name} isn't one of this profile's brands`);
    } else if (b.status === "confirmed") {
      add("brand", "pass", `your preferred brand (${brand.name})`);
    } else {
      add("brand", "review", b.note);
    }
  }

  // --- Counterfeit red flags --------------------------------------------------------
  if (facts.redFlags.length) {
    const effect: ReasonEffect = ctx.redFlags.policy === "exclude" ? "exclude" : ctx.redFlags.policy === "review" ? "review" : "info";
    add("authenticity", effect, `Contains “${facts.redFlags[0]}”${facts.redFlags.length > 1 ? ` (and ${facts.redFlags.length - 1} more)` : ""}, a counterfeit red flag`);
  }

  // --- Category + size ------------------------------------------------------------
  const c = facts.category;
  const cat = c.categoryId !== null ? ctx.categories.find((x) => x.id === c.categoryId) : undefined;
  if (!cat) {
    add("category", "review", "Couldn't determine the clothing category, so size can't be checked");
  } else if (!s.categoryIds.includes(cat.id)) {
    add("category", "exclude", `${cat.name} isn't part of this profile`);
  } else {
    add("category", "pass", cat.name);
    const titleNormForCategory = normalizePhrase(listing.title);
    for (const kw of cat.excludeKeywords) {
      const k = normalizePhrase(kw);
      if (k && containsPhrase(titleNormForCategory, k)) add("category", "exclude", `Title contains “${kw}”, which is excluded for ${cat.name}`);
    }
    const prefs = s.sizes[cat.id] ?? cat.defaultSizes;
    const label = evaluateSize(facts.size, prefs, cat.sizeSystem, cat.noun);
    // Your measurement ranges settle uncertain size labels; contradictions go to review.
    const sz = combineSizeAndMeasurements(label, judgeMeasurements(facts.measurements, cat.measurements), cat.noun);
    add("size", sz.state === "match" ? "pass" : sz.state === "review" ? "review" : "exclude", sz.message);
  }

  // --- Condition ------------------------------------------------------------------
  const cond = facts.condition;
  if (!cond.key) {
    add("condition", "review", cond.label ? `Condition “${cond.label}” isn't one of your configured conditions` : "Condition not stated");
  } else if (!s.conditionKeys.includes(cond.key)) {
    add("condition", "exclude", `Condition “${cond.label}” isn't accepted`);
  } else {
    add("condition", "pass", `${cond.label} condition`);
  }

  // --- Materials ------------------------------------------------------------------
  const assessment = assessMaterials(facts.materialReading, ctx.materials, s.excludedMaterialKeys);
  const reading = facts.materialReading;
  const nameOf = (k: string) => ctx.materials.find((m) => m.key === k)?.name ?? k;
  for (const hit of assessment.excludedHits) {
    add(
      "material",
      "exclude",
      `Contains ${hit.pct !== null ? hit.pct + "% " : ""}${hit.name.toLowerCase()}${hit.presumed ? " (share not stated)" : ""}, which you excluded`,
    );
  }
  if (s.requiredMaterialKeys.length) {
    const names = s.requiredMaterialKeys.map(nameOf).join(" or ");
    if (reading.status === "unknown") {
      add("material", "review", `Can't confirm a required material (${names}): seller did not provide fabric composition in the title, item specifics or description`);
    } else if (!s.requiredMaterialKeys.some((k) => assessment.keys.includes(k))) {
      add("material", "exclude", `None of the required materials (${names}) listed — ${assessment.summary}`);
    } else {
      add("material", "pass", `Required material present (${names})`);
    }
  } else if (reading.status === "unknown") {
    if (s.unknownMaterialPolicy === "review") {
      // Say where we looked: photos (e.g. a care-label shot) are never read automatically.
      const looked = listing.detailsFetched ? "checked the title, item specifics and description" : "checked the title only; item details not fetched yet";
      add(
        "material",
        "review",
        reading.fauxDetected.length
          ? `Seller did not provide genuine fabric composition (faux ${reading.fauxDetected.join(", ")} detected; ${looked})`
          : `Seller did not provide fabric composition (${looked})`,
      );
    } else {
      add("material", "info", "Fabric composition not provided (allowed by this profile)");
    }
  }
  for (const h of assessment.heavyAvoid) {
    add(
      "material",
      "info",
      `${h.pct !== null ? h.pct + "% " : ""}${h.name.toLowerCase()}${h.presumed ? " (share not stated)" : ""} — a material you generally avoid; ranked lower`,
    );
  }
  if (!assessment.excludedHits.length && (assessment.level === "very_high" || assessment.level === "high")) {
    add("material", "pass", `${assessment.summary} — ${PRIORITY_LABEL[assessment.level].toLowerCase()} material`);
  }
  if (reading.fauxDetected.length && reading.status !== "unknown") {
    add("material", "info", `Faux ${reading.fauxDetected.join(", ")} detected — not counted as genuine`);
  }

  // --- Keywords -------------------------------------------------------------------
  const titleNorm = normalizePhrase(listing.title);
  for (const kw of s.excludeKeywords) {
    const k = normalizePhrase(kw);
    if (k && containsPhrase(titleNorm, k)) add("keyword", "exclude", `Title contains excluded keyword “${kw}”`);
  }

  // --- Price range (profile filter, not the Cost Evaluator) ---------------------------
  if (s.priceMinMinor !== null || s.priceMaxMinor !== null) {
    if (listing.priceMinor === null) {
      add("price", "review", "Listing price unknown");
    } else if (s.priceMaxMinor !== null && listing.priceMinor > s.priceMaxMinor) {
      add("price", "exclude", `Price ${formatMoney(listing.priceMinor, listing.currency ?? "USD")} is above this profile's maximum ${formatMoney(s.priceMaxMinor)}`);
    } else if (s.priceMinMinor !== null && listing.priceMinor < s.priceMinMinor) {
      add("price", "exclude", `Price ${formatMoney(listing.priceMinor, listing.currency ?? "USD")} is below this profile's minimum ${formatMoney(s.priceMinMinor)}`);
    }
  }

  const state: MatchState = reasons.some((r) => r.effect === "exclude")
    ? "no_match"
    : reasons.some((r) => r.effect === "review")
      ? "review"
      : "match";

  return { profileId: profile.id, profileName: profile.name, state, reasons, summary: summarize(state, reasons) };
}

const DIMENSION_ORDER: Dimension[] = ["brand", "authenticity", "category", "size", "condition", "material", "keyword", "price"];

function summarize(state: MatchState, reasons: Reason[]): string {
  const ordered = [...reasons].sort((a, b) => DIMENSION_ORDER.indexOf(a.dimension) - DIMENSION_ORDER.indexOf(b.dimension));
  if (state === "no_match") {
    const first = ordered.find((r) => r.effect === "exclude")!;
    return `Excluded: ${lowerFirst(trimPeriod(first.message))}.`;
  }
  if (state === "review") {
    const msgs = ordered.filter((r) => r.effect === "review").map((r) => lowerFirst(trimPeriod(r.message)));
    return `Needs review: ${msgs.join("; ")}.`;
  }
  const brand = ordered.find((r) => r.dimension === "brand" && r.effect === "pass");
  const size = ordered.find((r) => r.dimension === "size" && r.effect === "pass");
  const material = ordered.find((r) => r.dimension === "material" && r.effect === "pass");
  let text = "Matches";
  if (brand && size) text += ` ${brand.message} and ${size.message}`;
  else if (brand) text += ` ${brand.message}`;
  else if (size) text += ` ${size.message}`;
  else text += " your preferences";
  text += ".";
  if (material) text += ` ${upperFirst(trimPeriod(material.message))}.`;
  const avoided = ordered.find((r) => r.dimension === "material" && r.effect === "info" && /generally avoid/.test(r.message));
  if (avoided) text += ` Note: ${trimPeriod(avoided.message)}.`;
  return text;
}

export function evaluateListing(listing: ListingForEvaluation, ctx: EngineContext): ListingEvaluation {
  const facts = extractFacts(listing, ctx);
  const profiles = ctx.profiles.filter((p) => p.enabled).map((p) => evaluateForProfile(listing, facts, p, ctx));
  let best: ProfileEvaluation | null = null;
  for (const p of profiles) if (!best || STATE_RANK[p.state] > STATE_RANK[best.state]) best = p;
  const state: MatchState = best ? best.state : "no_match";
  return {
    facts,
    profiles,
    state,
    summary: best ? best.summary : "Excluded: no search profiles are enabled.",
    matchedProfileIds: profiles.filter((p) => p.state === "match").map((p) => p.profileId),
    reviewProfileIds: profiles.filter((p) => p.state === "review").map((p) => p.profileId),
    materialScore: facts.material.score,
  };
}
