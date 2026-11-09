import type { BuyingOption, ItemAspect, NormalizedListing, ShippingStatus } from "../../domain/types";
import { parseMoneyToMinor } from "../../money";

/**
 * Map eBay Browse API JSON to NormalizedListing. Fields eBay does not supply
 * stay null — nothing is guessed. Search results (ItemSummary) carry no item
 * aspects; full details (Item, from getItem) add brand / size / material.
 */

interface EbayAmount {
  value?: string;
  currency?: string;
}

interface EbayShippingOption {
  shippingCostType?: string;
  shippingCost?: EbayAmount;
}

export interface EbayItemSummary {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  price?: EbayAmount;
  currentBidPrice?: EbayAmount;
  buyingOptions?: string[];
  shippingOptions?: EbayShippingOption[];
  image?: { imageUrl?: string };
  additionalImages?: Array<{ imageUrl?: string }>;
  itemWebUrl?: string;
  condition?: string;
  conditionId?: string;
  categories?: Array<{ categoryId?: string; categoryName?: string }>;
  leafCategoryIds?: string[];
  itemCreationDate?: string;
  itemOriginDate?: string;
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
}

/** Longest description text kept per listing (enough for fabric details; avoids storing whole pages). */
export const MAX_DESCRIPTION_CHARS = 4000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const safeChar = (code: number) => (Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ");

/** Convert seller description HTML to plain text (no rendering, no scripts). */
export function htmlToText(html: string | null | undefined, maxChars = MAX_DESCRIPTION_CHARS): string | null {
  if (!html) return null;
  const text = html
    .replace(/<(script|style|noscript|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/td)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z#0-9]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  if (!text) return null;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export interface EbayItem extends EbayItemSummary {
  brand?: string;
  size?: string;
  sizeType?: string;
  sizeSystem?: string;
  material?: string;
  color?: string;
  categoryId?: string;
  categoryPath?: string;
  localizedAspects?: Array<{ name?: string; value?: string; type?: string }>;
  estimatedAvailabilities?: Array<{ estimatedAvailabilityStatus?: string }>;
  itemEndDate?: string;
  description?: string;
  shortDescription?: string;
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const KNOWN_BUYING_OPTIONS: BuyingOption[] = ["FIXED_PRICE", "AUCTION", "BEST_OFFER", "CLASSIFIED_AD"];

export function mapShipping(options: EbayShippingOption[] | undefined): { status: ShippingStatus; minor: number | null; currency: string | null } {
  if (!options || options.length === 0) return { status: "unknown", minor: null, currency: null };
  let best: { minor: number; currency: string | null } | null = null;
  let sawCalculatedWithoutCost = false;
  for (const o of options) {
    const minor = o.shippingCost?.value !== undefined ? parseMoneyToMinor(o.shippingCost.value, o.shippingCost.currency ?? "USD") : null;
    if (minor === null) {
      if ((o.shippingCostType ?? "").toUpperCase() === "CALCULATED") sawCalculatedWithoutCost = true;
      continue;
    }
    if (!best || minor < best.minor) best = { minor, currency: o.shippingCost?.currency ?? null };
  }
  if (best) return { status: best.minor === 0 ? "free" : "fixed", minor: best.minor, currency: best.currency };
  return { status: sawCalculatedWithoutCost ? "calculated" : "unknown", minor: null, currency: null };
}

export function mapItemSummary(item: EbayItemSummary): NormalizedListing | null {
  if (!item.itemId || !item.title) return null;
  const buyingOptions = (item.buyingOptions ?? []).filter((b): b is BuyingOption => KNOWN_BUYING_OPTIONS.includes(b as BuyingOption));
  const auctionOnly = buyingOptions.includes("AUCTION") && !buyingOptions.includes("FIXED_PRICE");
  const priceSource = auctionOnly ? item.currentBidPrice ?? item.price : item.price ?? item.currentBidPrice;
  const currency = priceSource?.currency ?? null;
  const shipping = mapShipping(item.shippingOptions);
  const categoryIds = item.leafCategoryIds?.length
    ? item.leafCategoryIds
    : (item.categories ?? []).map((c) => c.categoryId).filter((x): x is string => !!x);
  return {
    source: "ebay",
    externalId: item.itemId,
    legacyId: item.legacyItemId ?? null,
    title: item.title,
    brandAspect: null,
    sizeAspect: null,
    materialAspect: null,
    aspects: [],
    ebayCategoryIds: categoryIds,
    ebayCategoryPath: item.categories?.length ? item.categories.map((c) => c.categoryName).filter(Boolean).join(" / ") : null,
    conditionText: item.condition ?? null,
    conditionId: item.conditionId ?? null,
    priceMinor: priceSource?.value !== undefined ? parseMoneyToMinor(priceSource.value, currency ?? "USD") : null,
    currency,
    shippingStatus: shipping.status,
    shippingMinor: shipping.minor,
    shippingCurrency: shipping.currency,
    buyingOptions,
    imageUrl: item.image?.imageUrl ?? null,
    additionalImageUrls: (item.additionalImages ?? []).map((i) => i.imageUrl).filter((x): x is string => !!x),
    itemUrl: item.itemWebUrl ?? null,
    listedAt: parseDate(item.itemCreationDate),
    originAt: parseDate(item.itemOriginDate) ?? parseDate(item.itemCreationDate),
    detailsFetched: false,
    description: null,
    // Used only for your seller minimums during the scan; never stored (no seller data is persisted).
    sellerFeedbackScore: typeof item.seller?.feedbackScore === "number" ? item.seller.feedbackScore : null,
    sellerFeedbackPercent: item.seller?.feedbackPercentage !== undefined && Number.isFinite(Number(item.seller.feedbackPercentage)) ? Number(item.seller.feedbackPercentage) : null,
  };
}

function aspectValue(aspects: ItemAspect[], names: string[]): string | null {
  const lower = names.map((n) => n.toLowerCase());
  return aspects.find((a) => lower.includes(a.name.trim().toLowerCase()))?.value ?? null;
}

/** Combine a numeric size with its length ("44" + "Regular" → "44 Regular"); letters stay as-is. */
export function composeSize(size: string | null, sizeType: string | null): string | null {
  if (!size) return null;
  const s = size.trim();
  const t = (sizeType ?? "").trim();
  if (/^\d{2}$/.test(s) && /^(regular|long|short|extra long)$/i.test(t)) return `${s} ${t}`;
  if (/^(x{0,3}s|m|x{0,3}l|\dxl)$/i.test(s) && /^tall$/i.test(t)) return `${s} Tall`;
  return s;
}

export function mapItemDetail(item: EbayItem): NormalizedListing | null {
  const base = mapItemSummary(item);
  if (!base) return null;
  const aspects: ItemAspect[] = (item.localizedAspects ?? [])
    .filter((a) => a.name && a.value)
    .map((a) => ({ name: a.name!, value: a.value! }));
  const sizeType = item.sizeType ?? aspectValue(aspects, ["Size Type", "Jacket/Coat Length", "Jacket Length", "Length"]);
  const size = item.size ?? aspectValue(aspects, ["Size", "Chest Size", "Size (Men's)"]);
  return {
    ...base,
    brandAspect: item.brand ?? aspectValue(aspects, ["Brand"]),
    sizeAspect: composeSize(size, sizeType),
    materialAspect: item.material ?? aspectValue(aspects, ["Material", "Outer Shell Material", "Fabric"]),
    aspects,
    ebayCategoryIds: item.categoryId ? [item.categoryId] : base.ebayCategoryIds,
    ebayCategoryPath: item.categoryPath ?? base.ebayCategoryPath,
    detailsFetched: true,
    description: htmlToText(item.description ?? item.shortDescription),
  };
}
