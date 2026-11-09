import type { MaterialPriority, SizeSystem, UnknownMaterialPolicy } from "../../lib/domain/types";
import { DEFAULT_RED_FLAG_PHRASES, type RedFlagPolicy } from "../../lib/matching/red-flags";

/**
 * Initial clothing profile. These are SEED values only: they are inserted once
 * into an empty database and are fully editable in the Preferences UI. The
 * matching logic never references these constants.
 */

export const SEED_VERSION = "1";

export const GROUP_LUXURY = "Highest-End Luxury";
export const GROUP_PREMIUM = "Premium Contemporary & Heritage";
export const GROUP_OUTERWEAR = "Jackets & Outerwear Specialists";

export const seedGroups = [
  { name: GROUP_LUXURY, description: "Brand Group 1", sortOrder: 1 },
  { name: GROUP_PREMIUM, description: "Brand Group 2", sortOrder: 2 },
  { name: GROUP_OUTERWEAR, description: "Brand Group 3", sortOrder: 3 },
];

interface SeedBrand {
  name: string;
  /** eBay search keywords when they should differ from the name. */
  searchQuery?: string;
  groups: string[];
  aliases?: string[];
  excludePhrases?: string[];
  notes?: string;
}

export const seedBrands: SeedBrand[] = [
  // Group 1 — Highest-End Luxury
  { name: "Brunello Cucinelli", groups: [GROUP_LUXURY] },
  {
    name: "Loro Piana",
    groups: [GROUP_LUXURY],
    notes: "Also a fabric mill: listings like “Suitsupply blazer in Loro Piana wool” are flagged for review, not matched.",
  },
  {
    name: "Zegna",
    groups: [GROUP_LUXURY],
    aliases: ["Ermenegildo Zegna"],
    excludePhrases: ["Z Zegna"],
    notes: "Z Zegna (diffusion line) is excluded by default — remove the exclusion to include it. Zegna fabric references on other brands go to review.",
  },
  { name: "Tom Ford", groups: [GROUP_LUXURY] },
  {
    name: "Ralph Lauren Purple Label",
    groups: [GROUP_LUXURY],
    aliases: ["RL Purple Label", "Purple Label Ralph Lauren", "Purple Label by Ralph Lauren"],
    notes: "Requires “Purple Label” together with Ralph Lauren/RL. Plain Ralph Lauren, Polo Ralph Lauren and The North Face Purple Label do not match.",
  },
  { name: "Kiton", groups: [GROUP_LUXURY] },
  { name: "Isaia", groups: [GROUP_LUXURY] },
  { name: "Saint Laurent", groups: [GROUP_LUXURY], aliases: ["Yves Saint Laurent", "YSL"] },
  { name: "Berluti", groups: [GROUP_LUXURY] },

  // Group 2 — Premium Contemporary and Heritage
  { name: "Todd Snyder", groups: [GROUP_PREMIUM, GROUP_OUTERWEAR] },
  { name: "Valstar", groups: [GROUP_PREMIUM, GROUP_OUTERWEAR], aliases: ["Valstarino"] },
  { name: "John Smedley", groups: [GROUP_PREMIUM] },
  { name: "Sunspel", groups: [GROUP_PREMIUM] },
  { name: "Drake's", groups: [GROUP_PREMIUM], aliases: ["Drakes"] },
  { name: "RRL", groups: [GROUP_PREMIUM], aliases: ["Double RL"] },
  { name: "Officine Générale", searchQuery: "Officine Generale", groups: [GROUP_PREMIUM], aliases: ["Officine Generale"] },
  { name: "Our Legacy", groups: [GROUP_PREMIUM] },
  { name: "A.P.C.", searchQuery: "APC", groups: [GROUP_PREMIUM], aliases: ["APC"] },
  { name: "AMI Paris", groups: [GROUP_PREMIUM], aliases: ["Ami Alexandre Mattiussi"] },
  { name: "Acne Studios", groups: [GROUP_PREMIUM], aliases: ["Acne"] },
  { name: "Norse Projects", groups: [GROUP_PREMIUM] },
  { name: "Barena", groups: [GROUP_PREMIUM] },
  { name: "Boglioli", groups: [GROUP_PREMIUM] },
  { name: "Incotex", groups: [GROUP_PREMIUM] },
  { name: "Corneliani", groups: [GROUP_PREMIUM] },
  { name: "Finamore", groups: [GROUP_PREMIUM] },
  { name: "Eton", groups: [GROUP_PREMIUM] },
  { name: "Gitman Vintage", groups: [GROUP_PREMIUM], aliases: ["Gitman Bros Vintage", "Gitman Brothers Vintage"] },

  // Group 3 — Jackets and Outerwear Specialists (Valstar & Todd Snyder above)
  { name: "Private White V.C.", searchQuery: "Private White", groups: [GROUP_OUTERWEAR], aliases: ["Private White"] },
  { name: "Belstaff", groups: [GROUP_OUTERWEAR] },
  { name: "Herno", groups: [GROUP_OUTERWEAR] },
  { name: "Schott", groups: [GROUP_OUTERWEAR], aliases: ["Schott NYC"] },
  {
    name: "Golden Bear",
    groups: [GROUP_OUTERWEAR],
    excludePhrases: ["Jack Nicklaus", "Nicklaus"],
    notes: "Excludes Jack Nicklaus “Golden Bear” golf apparel, an unrelated brand.",
  },
  { name: "Baracuta", groups: [GROUP_OUTERWEAR] },
  { name: "Dehen 1920", searchQuery: "Dehen", groups: [GROUP_OUTERWEAR], aliases: ["Dehen"] },
  { name: "Aspesi", groups: [GROUP_OUTERWEAR] },
];

interface SeedCategory {
  slug: string;
  name: string;
  noun: string;
  description: string;
  sizeSystem: SizeSystem;
  acceptedSizes: string[];
  reviewSizes: string[];
  ebayCategoryIds: string[];
  titleKeywords: string[];
  excludeKeywords: string[];
  sortOrder: number;
}

/**
 * eBay US category IDs were checked against eBay's own category pages
 * (Nov 2026): 15687 Men's T-Shirts, 185101 Men's Polos, 57990 Men's Casual
 * Button-Down Shirts, 57991 Men's Dress Shirts, 57988 Men's Coats, Jackets &
 * Vests, 3001 Men's Suits & Suit Separates (blazers/sport coats were merged
 * into 3001 when 3002 was retired). All are editable in Preferences.
 */
export const seedCategories: SeedCategory[] = [
  {
    slug: "shirts",
    name: "Shirts",
    noun: "shirt",
    description: "T-shirts and polos. eBay files casual button-front shirts under Casual Button-Down Shirts, which is mapped to Button-Down Shirts.",
    sizeSystem: "alpha",
    acceptedSizes: ["L", "XL"],
    reviewSizes: [],
    ebayCategoryIds: ["15687", "185101"],
    titleKeywords: ["t shirt", "tshirt", "tee", "polo", "henley", "shirt"],
    excludeKeywords: [],
    sortOrder: 1,
  },
  {
    slug: "button-down-shirts",
    name: "Button-Down Shirts",
    noun: "button-down shirt",
    description: "Casual button-down and dress shirts. Neck/sleeve sizes are supported but not set yet.",
    sizeSystem: "alpha_neck_sleeve",
    acceptedSizes: ["L", "XL"],
    reviewSizes: [],
    ebayCategoryIds: ["57990", "57991"],
    titleKeywords: ["button down", "button up", "button front", "oxford shirt", "dress shirt", "ocbd", "sport shirt", "overshirt"],
    excludeKeywords: [],
    sortOrder: 2,
  },
  {
    slug: "jackets-outerwear",
    name: "Jackets & Outerwear",
    noun: "jacket",
    description: "Coats, jackets, vests, blazers and sport coats. XL jackets go to review — they are never assumed to be 44R.",
    sizeSystem: "tailored",
    acceptedSizes: ["44R"],
    reviewSizes: ["XL"],
    ebayCategoryIds: ["57988", "3001"],
    titleKeywords: ["jacket", "blazer", "sport coat", "sportcoat", "coat", "overcoat", "topcoat", "parka", "bomber", "harrington", "gilet", "field jacket"],
    excludeKeywords: ["trousers", "pants", "2 piece suit", "two piece suit", "3 piece suit", "three piece suit", "suit trousers"],
    sortOrder: 3,
  },
];

interface SeedMaterial {
  key: string;
  name: string;
  kind: "fiber" | "blend";
  priority: MaterialPriority;
  keywords?: string[];
  components?: string[];
  heavyThresholdPct?: number | null;
  notes?: string;
}

export const seedMaterials: SeedMaterial[] = [
  // Very high priority
  { key: "merino_wool", name: "Merino wool", kind: "fiber", priority: "very_high", keywords: ["merino", "merino wool", "extrafine merino", "extra fine merino"] },
  {
    key: "wool",
    name: "Wool",
    kind: "fiber",
    priority: "very_high",
    keywords: ["wool", "virgin wool", "new wool", "lambswool", "lambs wool", "worsted", "worsted wool", "lana", "laine", "wolle", "schurwolle", "loden"],
    notes: "You listed “quality wool”. Quality can't be verified from a listing, so this matches the fiber; stated grades (e.g. Super 130s) are shown as facts.",
  },
  {
    key: "suede",
    name: "Suede",
    kind: "fiber",
    priority: "very_high",
    keywords: ["suede", "scamosciato", "camoscio", "daim"],
    notes: "Genuine suede only — faux suede, microsuede, Ultrasuede and Alcantara are detected and not counted.",
  },
  {
    key: "leather",
    name: "Leather",
    kind: "fiber",
    priority: "very_high",
    keywords: ["leather", "lambskin", "calfskin", "cowhide", "goatskin", "deerskin", "horsehide", "nappa", "sheepskin", "shearling", "pelle", "cuir"],
    notes: "Genuine leather only — PU, vegan, faux and bonded leather are detected and not counted. You listed “quality leather”; quality itself isn't verifiable.",
  },
  // High priority
  { key: "cashmere", name: "Cashmere", kind: "fiber", priority: "high", keywords: ["cashmere", "cachemire", "kaschmir"] },
  { key: "silk", name: "Silk", kind: "fiber", priority: "high", keywords: ["silk", "seta", "soie", "seide"], notes: "“Silk screen” prints are ignored." },
  { key: "silk_cotton_blend", name: "Silk-cotton blend", kind: "blend", priority: "high", components: ["silk", "cotton"] },
  {
    key: "cotton",
    name: "Cotton",
    kind: "fiber",
    priority: "high",
    keywords: ["cotton", "cotone", "coton", "baumwolle", "supima", "pima", "egyptian cotton", "sea island cotton", "giza cotton"],
    notes: "You listed “quality cotton”. Stated varieties (Supima, Pima, Egyptian, Sea Island, Giza) are shown as facts; “premium” claims are not.",
  },
  { key: "linen", name: "Linen", kind: "fiber", priority: "high", keywords: ["linen", "flax", "lino", "leinen"] },
  { key: "cotton_wool_blend", name: "Cotton-wool blend", kind: "blend", priority: "high", components: ["cotton", "wool"] },
  // Generally avoid
  {
    key: "polyester",
    name: "Polyester",
    kind: "fiber",
    priority: "avoid",
    keywords: ["polyester", "poly", "poliestere", "pes"],
    heavyThresholdPct: 50,
    notes: "“Polyester-heavy” = 50% or more (or the only/first fiber listed when no percentages are given). Linings are ignored.",
  },
  { key: "acrylic", name: "Acrylic", kind: "fiber", priority: "avoid", keywords: ["acrylic", "acrilico", "acryl", "polyacrylic"], heavyThresholdPct: 50 },
  // Recognized but neutral (so compositions parse correctly)
  { key: "nylon", name: "Nylon / polyamide", kind: "fiber", priority: "neutral", keywords: ["nylon", "polyamide", "poliammide"] },
  { key: "elastane", name: "Elastane", kind: "fiber", priority: "neutral", keywords: ["elastane", "spandex", "lycra", "elastan"] },
  { key: "viscose", name: "Viscose / rayon", kind: "fiber", priority: "neutral", keywords: ["viscose", "rayon", "modal", "lyocell", "tencel", "cupro", "bemberg", "acetate"] },
  { key: "alpaca", name: "Alpaca", kind: "fiber", priority: "neutral", keywords: ["alpaca"] },
  { key: "mohair", name: "Mohair", kind: "fiber", priority: "neutral", keywords: ["mohair"] },
  { key: "camel_hair", name: "Camel hair", kind: "fiber", priority: "neutral", keywords: ["camel hair", "camelhair"] },
  { key: "vicuna", name: "Vicuña", kind: "fiber", priority: "neutral", keywords: ["vicuna"] },
];

/** eBay condition IDs verified against eBay's condition-ID reference (apparel grades added 2024–2025). */
export const seedConditions = [
  { key: "new_with_tags", name: "New with tags", ebayConditionIds: ["1000"], matchTerms: ["new with tags", "nwt", "brand new with tags"], sortOrder: 1 },
  { key: "new_without_tags", name: "New without tags", ebayConditionIds: ["1500"], matchTerms: ["new without tags", "nwot", "new other"], sortOrder: 2 },
  { key: "new_with_defects", name: "New with defects", ebayConditionIds: ["1750"], matchTerms: ["new with defects"], sortOrder: 3 },
  { key: "preowned_excellent", name: "Pre-owned – Excellent", ebayConditionIds: ["2990"], matchTerms: ["pre owned excellent", "used excellent"], sortOrder: 4 },
  { key: "preowned_good", name: "Pre-owned – Good", ebayConditionIds: ["3000"], matchTerms: ["pre owned good", "pre owned", "used"], sortOrder: 5 },
  { key: "preowned_fair", name: "Pre-owned – Fair", ebayConditionIds: ["3010"], matchTerms: ["pre owned fair", "used fair"], sortOrder: 6 },
];

export interface SeedProfile {
  name: string;
  description: string;
  groupNames?: string[];
  categorySlugs?: string[];
  sortOrder: number;
}

export const seedProfiles: SeedProfile[] = [
  {
    name: "All Preferences",
    description: "Inherits every personal default — all enabled brands, categories, sizes, conditions and material rules.",
    sortOrder: 1,
  },
  {
    name: "Luxury Shirts",
    description: "Highest-end luxury brands, shirts and button-downs.",
    groupNames: [GROUP_LUXURY],
    categorySlugs: ["shirts", "button-down-shirts"],
    sortOrder: 2,
  },
  {
    name: "Heritage Jackets",
    description: "Jackets & outerwear specialists.",
    groupNames: [GROUP_OUTERWEAR],
    categorySlugs: ["jackets-outerwear"],
    sortOrder: 3,
  },
  {
    name: "Premium Button-Downs",
    description: "Luxury and premium brands, button-down shirts only.",
    groupNames: [GROUP_LUXURY, GROUP_PREMIUM],
    categorySlugs: ["button-down-shirts"],
    sortOrder: 4,
  },
];

export interface DefaultsSetting {
  unknownMaterialPolicy: UnknownMaterialPolicy;
  excludeKeywords: string[];
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  /** Counterfeit red-flag phrases (title or description; negated mentions ignored). */
  redFlagPhrases: string[];
  /** What a red flag does: exclude the listing, send it to review, or just flag it. */
  redFlagPolicy: RedFlagPolicy;
}

export const seedDefaults: DefaultsSetting = {
  unknownMaterialPolicy: "review",
  excludeKeywords: [],
  priceMinMinor: null,
  priceMaxMinor: null,
  redFlagPhrases: DEFAULT_RED_FLAG_PHRASES,
  redFlagPolicy: "exclude",
};

export interface ScanSettings {
  /** Only consider listings posted within this many days (by eBay's original listing date). */
  maxListingAgeDays: number;
  /** Results per search page (eBay max 200). */
  pageSize: number;
  /** Maximum pages per query per scan (each page is one API call). */
  maxPagesPerQuery: number;
  /** Re-check this many hours before the newest listing already seen (eBay can index new listings late). */
  lookbackHours: number;
  /** Max item-detail (getItem) calls per scan for size/material/brand enrichment. */
  detailFetchLimit: number;
  /** Daily call budget across searches and detail calls (eBay default Browse limit: 5,000/day). */
  dailyCallBudget: number;
  /** Minimum delay between eBay calls, in milliseconds. */
  requestIntervalMs: number;
  /** eBay returns Buy It Now listings by default; enable to include auctions. */
  includeAuctions: boolean;
  /** Only listings that deliver to this country (ISO code), or "" for no filter. */
  deliveryCountry: string;
  /** Delete listing content not confirmed by eBay for this many days (eBay requires deletion of unavailable content; ≤ 30). */
  retentionDays: number;
  /** Listing data older than this is labeled stale (eBay: ≤ 6 hours unless the age is disclosed). */
  staleAfterHours: number;
  /** Skip listings from sellers below this feedback score (null = off). Applied during scans; seller data isn't stored. */
  minSellerFeedbackScore: number | null;
  /** Skip listings from sellers below this positive-feedback percentage (null = off). */
  minSellerFeedbackPercent: number | null;
}

export const seedScanSettings: ScanSettings = {
  maxListingAgeDays: 7,
  pageSize: 200,
  maxPagesPerQuery: 2,
  lookbackHours: 24,
  detailFetchLimit: 100,
  dailyCallBudget: 5000,
  requestIntervalMs: 250,
  includeAuctions: false,
  deliveryCountry: "US",
  retentionDays: 14,
  staleAfterHours: 6,
  minSellerFeedbackScore: null,
  minSellerFeedbackPercent: null,
};
