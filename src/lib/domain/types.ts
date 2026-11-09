/**
 * Core domain types shared by the provider layer (data acquisition), the
 * matching engine (Product Finder) and the pricing engine (Cost Evaluator).
 * Nothing in here touches the database or the network.
 */

export type MatchState = "match" | "review" | "no_match";
export type ListingSource = "ebay" | "fixture";
export type ShippingStatus = "free" | "fixed" | "calculated" | "unknown";
export type BuyingOption = "FIXED_PRICE" | "AUCTION" | "BEST_OFFER" | "CLASSIFIED_AD";

export interface ItemAspect {
  name: string;
  value: string;
}

/**
 * A listing as normalized by a provider. Missing data stays null — providers
 * must never invent values that the source did not supply.
 */
export interface NormalizedListing {
  source: ListingSource;
  externalId: string;
  legacyId: string | null;
  title: string;
  /** Brand from structured item specifics (aspect), when provided. */
  brandAspect: string | null;
  /** Size from structured item specifics, when provided. */
  sizeAspect: string | null;
  /** Material / composition from structured item specifics, when provided. */
  materialAspect: string | null;
  aspects: ItemAspect[];
  ebayCategoryIds: string[];
  ebayCategoryPath: string | null;
  conditionText: string | null;
  conditionId: string | null;
  priceMinor: number | null;
  currency: string | null;
  shippingStatus: ShippingStatus;
  shippingMinor: number | null;
  shippingCurrency: string | null;
  buyingOptions: BuyingOption[];
  imageUrl: string | null;
  additionalImageUrls: string[];
  itemUrl: string | null;
  /** eBay itemCreationDate — when this listing was created. */
  listedAt: Date | null;
  /** eBay itemOriginDate — first made available (kept across relists); eBay's newlyListed sort uses it. */
  originAt: Date | null;
  /** True when provider fetched full item details (aspects) for this listing. */
  detailsFetched: boolean;
}

// ---------------------------------------------------------------------------
// Preference / configuration shapes consumed by the engines
// ---------------------------------------------------------------------------

export type MaterialPriority = "very_high" | "high" | "neutral" | "avoid" | "exclude";
export type SizeSystem = "alpha" | "tailored" | "alpha_neck_sleeve";
export type UnknownMaterialPolicy = "review" | "allow";

export interface BrandConfig {
  id: number;
  name: string;
  /** eBay search keywords for this brand. */
  searchQuery?: string;
  enabled: boolean;
  aliases: string[];
  /** Phrases that, when present, mean this brand should NOT be matched (e.g. diffusion lines). */
  excludePhrases: string[];
  groupIds: number[];
}

export interface BrandGroupConfig {
  id: number;
  name: string;
}

export interface SizePrefs {
  accepted: string[];
  /** Sizes that might fit: listings in these sizes go to Needs Review instead of being excluded. */
  review: string[];
  /** Neck sizes in inches, e.g. "16.5" (button-down shirts). Empty = not specified. */
  neck: string[];
  /** Sleeve lengths in inches, e.g. "34", "35". Empty = not specified. */
  sleeve: string[];
}

export interface CategoryConfig {
  id: number;
  slug: string;
  name: string;
  /** Singular noun used in explanations, e.g. "shirt", "jacket". */
  noun: string;
  enabled: boolean;
  sizeSystem: SizeSystem;
  defaultSizes: SizePrefs;
  ebayCategoryIds: string[];
  titleKeywords: string[];
  /** Title phrases that exclude a listing from this category (e.g. "trousers" for jackets). */
  excludeKeywords: string[];
}

export interface MaterialConfig {
  key: string;
  name: string;
  kind: "fiber" | "blend";
  priority: MaterialPriority;
  /** Detection phrases (fibers only). */
  keywords: string[];
  /** For blends: material keys that must all be present. */
  components: string[];
  /** For avoid/exclude: only applies when share ≥ this percent (null = any amount). */
  heavyThresholdPct: number | null;
}

export interface ConditionConfig {
  key: string;
  name: string;
  ebayConditionIds: string[];
  matchTerms: string[];
  accepted: boolean;
}

export interface EffectiveProfileSettings {
  brandIds: number[];
  categoryIds: number[];
  sizes: Record<number, SizePrefs>;
  conditionKeys: string[];
  requiredMaterialKeys: string[];
  excludedMaterialKeys: string[];
  unknownMaterialPolicy: UnknownMaterialPolicy;
  excludeKeywords: string[];
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
}

export interface ProfileForEvaluation {
  id: number;
  name: string;
  enabled: boolean;
  settings: EffectiveProfileSettings;
}
