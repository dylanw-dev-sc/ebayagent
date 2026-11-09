import type { ShippingStatus } from "../domain/types";
import type { MaterialReading } from "../matching/material";
import { computeCeilingMinor, formatBps, formatMoney, isWithinCeiling } from "../money";
import { uniq } from "../text";

/**
 * Cost Evaluator — independent of the matching engine.
 *
 *   Maximum Secondhand Price = Reference Retail Price × Allowed Retail Percentage
 *   Actual Listing Cost      = Item Price + Shipping
 *   % of retail              = Actual Listing Cost ÷ Reference Retail Price
 *
 * Where the reference (new) price comes from — the first that applies wins:
 *   1. your price for this listing (product override)
 *   2. your brand + category + material rule      3. your brand + category rule
 *   4. the typical new price found online for this kind of item (labeled, with sources)
 *   5. your category + material rule              6. your category-wide rule
 * A rule or override without its own % uses your default %.
 * All arithmetic is integer minor units; the ceiling comparison is exact.
 * This is a price-eligibility check, NOT a bargain or deal rating.
 */

/** Your starting default: a third of retail (you chose 30–35%). */
export const DEFAULT_ALLOWED_BPS = 3300;

export interface PricingRule {
  id: number;
  categoryId: number;
  brandId: number | null;
  /** Only for listings mainly made of this material (e.g. cashmere); null = any material. */
  materialKey: string | null;
  referenceRetailMinor: number;
  currency: string;
  /** null = use your default %. */
  allowedBps: number | null;
  retailSource: string | null;
  active: boolean;
}

export interface PriceOverride {
  referenceRetailMinor: number;
  /** null = use your default %. */
  allowedBps: number | null;
  currency: string;
  retailSource: string | null;
}

/** The typical new price found online for this kind of item (median of several stores). */
export interface OnlinePrice {
  id: number;
  typicalMinor: number;
  currency: string;
  sourceCount: number;
}

export interface PricingOptions {
  /** Your default allowed share of retail, for rules/overrides without their own % and for online prices. */
  defaultAllowedBps: number;
}

export interface PricingInput {
  priceMinor: number | null;
  currency: string | null;
  shippingStatus: ShippingStatus;
  shippingMinor: number | null;
  shippingCurrency: string | null;
  isAuction: boolean;
  brandId: number | null;
  categoryId: number | null;
  /** The listing's materials for pricing, main material first (see `pricingMaterialKeys`). */
  materialKeys?: string[];
  /** Typical new price found online for this listing's kind of item, if any. */
  online?: OnlinePrice | null;
}

export type PricingStatus = "eligible" | "over_ceiling" | "needs_review";
export type PricingReason =
  | "within_ceiling"
  | "above_ceiling"
  | "item_alone_above_ceiling"
  | "no_rule"
  | "no_category"
  | "shipping_unknown"
  | "currency_mismatch"
  | "price_unknown";
export type RuleLevel = "override" | "brand_category_material" | "brand_category" | "online" | "category_material" | "category";

/** Short labels for where the reference price came from. */
export const RULE_LEVEL_LABEL: Record<RuleLevel, string> = {
  override: "Your price for this listing",
  brand_category_material: "Your brand + material price",
  brand_category: "Your brand price",
  online: "Online price",
  category_material: "Your category + material price",
  category: "Your category-wide price",
};

export interface PricingDecision {
  status: PricingStatus;
  reason: PricingReason;
  ruleLevel: RuleLevel | null;
  ruleId: number | null;
  referenceRetailMinor: number | null;
  allowedBps: number | null;
  /** The allowed % is your default (the rule or override left it blank, or the price came from online). */
  usesDefaultBps: boolean;
  maxPriceMinor: number | null;
  itemMinor: number | null;
  shippingMinor: number | null;
  totalMinor: number | null;
  /** Total ÷ reference retail in basis points, rounded up so it's never understated. */
  pctOfRetailBps: number | null;
  /** Shipping is unknown, so the % covers the item price only. */
  pctIsLowerBound: boolean;
  /** The online price lookup used, when that's the source. */
  retailLookupId: number | null;
  currency: string;
  explanation: string;
}

export interface NamedLookup {
  brandName: (id: number | null) => string | null;
  categoryName: (id: number | null) => string | null;
  materialName?: (key: string | null) => string | null;
}

/**
 * The listing's materials in pricing order: blends first (most specific), then stated
 * fibers by share (largest first), then implied fibers (merino → wool).
 */
export function pricingMaterialKeys(reading: Pick<MaterialReading, "components" | "blendKeys"> | null | undefined): string[] {
  if (!reading) return [];
  const stated = reading.components.filter((c) => !c.implied).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  const implied = reading.components.filter((c) => c.implied);
  return uniq([...reading.blendKeys, ...stated.map((c) => c.key), ...implied.map((c) => c.key)]);
}

export type RuleSelection =
  | { level: "override"; override: PriceOverride; rule: null; online: null }
  | { level: "online"; online: OnlinePrice; rule: null; override: null }
  | { level: Exclude<RuleLevel, "override" | "online">; rule: PricingRule; override: null; online: null };

export function selectRule(
  input: Pick<PricingInput, "brandId" | "categoryId" | "materialKeys" | "online">,
  rules: PricingRule[],
  override: PriceOverride | null,
): RuleSelection | null {
  if (override) return { level: "override", override, rule: null, online: null };
  if (input.categoryId === null) return null;
  const active = rules.filter((r) => r.active && r.categoryId === input.categoryId);
  const materials = input.materialKeys ?? [];
  // A material-specific rule for the listing's main material wins over the general one.
  const pick = (candidates: PricingRule[]): { rule: PricingRule; byMaterial: boolean } | null => {
    for (const m of materials) {
      const rule = candidates.find((r) => r.materialKey === m);
      if (rule) return { rule, byMaterial: true };
    }
    const general = candidates.find((r) => !r.materialKey);
    return general ? { rule: general, byMaterial: false } : null;
  };
  if (input.brandId !== null) {
    const b = pick(active.filter((r) => r.brandId === input.brandId));
    if (b) return { level: b.byMaterial ? "brand_category_material" : "brand_category", rule: b.rule, override: null, online: null };
  }
  if (input.online) return { level: "online", online: input.online, rule: null, override: null };
  const c = pick(active.filter((r) => r.brandId === null));
  if (c) return { level: c.byMaterial ? "category_material" : "category", rule: c.rule, override: null, online: null };
  return null;
}

/** Amount as a share of retail, in basis points, rounded up. */
export function pctOfRetailBps(amountMinor: number, retailMinor: number): number {
  return Math.ceil((amountMinor * 10000) / retailMinor);
}

/** "12%" — whole percent, rounded up so a cost is never understated; "12%+" when shipping is unknown. */
export function formatPctOfRetail(bps: number | null, lowerBound = false): string {
  if (bps === null) return "—";
  return `${Math.ceil(bps / 100)}%${lowerBound ? "+" : ""}`;
}

/** Actual Listing Cost = Item Price + Shipping — only when both are known and in one currency. */
export function totalCostMinor(input: Pick<PricingInput, "priceMinor" | "currency" | "shippingStatus" | "shippingMinor" | "shippingCurrency">): number | null {
  if (input.priceMinor === null) return null;
  if (input.shippingStatus === "free") return input.priceMinor;
  if (input.shippingStatus !== "fixed" || input.shippingMinor === null) return null;
  if (input.shippingCurrency && input.currency && input.shippingCurrency !== input.currency) return null;
  return input.priceMinor + input.shippingMinor;
}

export function decidePricing(
  input: PricingInput,
  rules: PricingRule[],
  override: PriceOverride | null,
  names: NamedLookup,
  options: PricingOptions = { defaultAllowedBps: DEFAULT_ALLOWED_BPS },
): PricingDecision {
  const currency = input.currency ?? "USD";
  const base: Omit<PricingDecision, "status" | "reason" | "explanation"> = {
    ruleLevel: null,
    ruleId: null,
    referenceRetailMinor: null,
    allowedBps: null,
    usesDefaultBps: false,
    maxPriceMinor: null,
    itemMinor: input.priceMinor,
    shippingMinor: input.shippingStatus === "free" ? 0 : input.shippingMinor,
    totalMinor: totalCostMinor(input),
    pctOfRetailBps: null,
    pctIsLowerBound: false,
    retailLookupId: null,
    currency,
  };

  const selection = selectRule(input, rules, override);
  if (!selection) {
    if (input.categoryId === null) {
      return { ...base, status: "needs_review", reason: "no_category", explanation: "Needs pricing review: the listing's category is unknown, so no pricing rule can apply." };
    }
    const brand = names.brandName(input.brandId);
    const cat = names.categoryName(input.categoryId);
    return {
      ...base,
      status: "needs_review",
      reason: "no_rule",
      explanation: `Needs pricing review: no reference price for ${brand ? `${brand} / ` : ""}${cat} yet (no rule of yours applies${input.online === undefined ? "" : " and no online price was found"}).`,
    };
  }

  const ref =
    selection.level === "override"
      ? { retail: selection.override.referenceRetailMinor, bps: selection.override.allowedBps, currency: selection.override.currency }
      : selection.level === "online"
        ? { retail: selection.online.typicalMinor, bps: null, currency: selection.online.currency }
        : { retail: selection.rule.referenceRetailMinor, bps: selection.rule.allowedBps, currency: selection.rule.currency };
  const retail = ref.retail;
  const usesDefaultBps = ref.bps === null;
  const bps = ref.bps ?? options.defaultAllowedBps;
  const ruleCurrency = ref.currency;
  const max = computeCeilingMinor(retail, bps);
  const brandText = names.brandName(input.brandId);
  const catText = names.categoryName(input.categoryId);
  const matText = (key: string | null) => (names.materialName?.(key) ?? key ?? "").toLowerCase();
  const levelText: string = (() => {
    switch (selection.level) {
      case "override":
        return "product override";
      case "online":
        return `typical new price online, ${selection.online.sourceCount} sources`;
      case "brand_category_material":
        return `${brandText} / ${catText} / ${matText(selection.rule.materialKey)} rule`;
      case "brand_category":
        return `${brandText} / ${catText} rule`;
      case "category_material":
        return `${catText} / ${matText(selection.rule.materialKey)} rule`;
      case "category":
        return `${catText} category-wide rule`;
    }
  })();
  const ceilingText = `${formatMoney(max, ruleCurrency)} ceiling (${formatBps(bps)} of ${formatMoney(retail, ruleCurrency)} retail · ${levelText}${usesDefaultBps ? " · your default %" : ""})`;
  const withRule = {
    ...base,
    ruleLevel: selection.level,
    ruleId: selection.rule?.id ?? null,
    referenceRetailMinor: retail,
    allowedBps: bps,
    usesDefaultBps,
    maxPriceMinor: max,
    retailLookupId: selection.online?.id ?? null,
  };

  if (input.priceMinor === null) {
    return { ...withRule, status: "needs_review", reason: "price_unknown", explanation: `Needs pricing review: listing price is unknown. Ceiling is ${ceilingText}.` };
  }
  if (currency !== ruleCurrency || (input.shippingCurrency && input.shippingStatus === "fixed" && input.shippingCurrency !== currency)) {
    return {
      ...withRule,
      status: "needs_review",
      reason: "currency_mismatch",
      explanation: `Needs pricing review: listing is priced in ${currency}${input.shippingCurrency && input.shippingCurrency !== currency ? ` with ${input.shippingCurrency} shipping` : ""} but the rule is in ${ruleCurrency}. Currencies are not converted.`,
    };
  }
  const auctionNote = input.isAuction ? " Auction: based on the current bid; the final price may be higher." : "";

  const shippingKnown = input.shippingStatus === "free" || (input.shippingStatus === "fixed" && input.shippingMinor !== null);
  if (!shippingKnown) {
    const itemPct = pctOfRetailBps(input.priceMinor, retail);
    const withPct = { ...withRule, pctOfRetailBps: itemPct, pctIsLowerBound: true };
    if (!isWithinCeiling(input.priceMinor, retail, bps)) {
      return {
        ...withPct,
        status: "over_ceiling",
        reason: "item_alone_above_ceiling",
        explanation: `Over ceiling: item price ${formatMoney(input.priceMinor, currency)} alone is ${formatPctOfRetail(itemPct)} of retail and exceeds the ${ceilingText}; shipping is unknown.${auctionNote}`,
      };
    }
    return {
      ...withPct,
      status: "needs_review",
      reason: "shipping_unknown",
      explanation: `Needs pricing review: item price ${formatMoney(input.priceMinor, currency)} is ${formatPctOfRetail(itemPct)} of retail before shipping and within the ${ceilingText}, but shipping cost is unknown${input.shippingStatus === "calculated" ? " (calculated at checkout)" : ""}. Shipping is never assumed to be free.${auctionNote}`,
    };
  }

  const shipping = input.shippingStatus === "free" ? 0 : input.shippingMinor!;
  const total = input.priceMinor + shipping;
  const breakdown = `${formatMoney(input.priceMinor, currency)} + ${shipping === 0 ? "free shipping" : `${formatMoney(shipping, currency)} shipping`}`;
  const pct = pctOfRetailBps(total, retail);
  if (isWithinCeiling(total, retail, bps)) {
    return {
      ...withRule,
      shippingMinor: shipping,
      totalMinor: total,
      pctOfRetailBps: pct,
      status: "eligible",
      reason: "within_ceiling",
      explanation: `Price-eligible: total ${formatMoney(total, currency)} (${breakdown}) is ${formatPctOfRetail(pct)} of retail, within the ${ceilingText}.${auctionNote}`,
    };
  }
  return {
    ...withRule,
    shippingMinor: shipping,
    totalMinor: total,
    pctOfRetailBps: pct,
    status: "over_ceiling",
    reason: "above_ceiling",
    explanation: `Over ceiling: total ${formatMoney(total, currency)} (${breakdown}) is ${formatPctOfRetail(pct)} of retail and exceeds the ${ceilingText} by ${formatMoney(total - max, currency)}.${auctionNote}`,
  };
}
