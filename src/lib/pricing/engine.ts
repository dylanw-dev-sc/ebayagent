import type { ShippingStatus } from "../domain/types";
import { computeCeilingMinor, formatBps, formatMoney, isWithinCeiling } from "../money";

/**
 * Cost Evaluator — independent of the matching engine.
 *
 *   Maximum Secondhand Price = Reference Retail Price × Allowed Retail Percentage
 *   Actual Listing Cost      = Item Price + Shipping
 *
 * Precedence: 1) product-specific override, 2) brand/category rule, 3) category-wide rule.
 * All arithmetic is integer minor units; the ceiling comparison is exact.
 * This is a price-eligibility check, NOT a bargain or deal rating.
 */

export interface PricingRule {
  id: number;
  categoryId: number;
  brandId: number | null;
  referenceRetailMinor: number;
  currency: string;
  allowedBps: number;
  retailSource: string | null;
  active: boolean;
}

export interface PriceOverride {
  referenceRetailMinor: number;
  allowedBps: number;
  currency: string;
  retailSource: string | null;
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
export type RuleLevel = "override" | "brand_category" | "category";

export interface PricingDecision {
  status: PricingStatus;
  reason: PricingReason;
  ruleLevel: RuleLevel | null;
  ruleId: number | null;
  referenceRetailMinor: number | null;
  allowedBps: number | null;
  maxPriceMinor: number | null;
  itemMinor: number | null;
  shippingMinor: number | null;
  totalMinor: number | null;
  currency: string;
  explanation: string;
}

export interface NamedLookup {
  brandName: (id: number | null) => string | null;
  categoryName: (id: number | null) => string | null;
}

export function selectRule(
  input: Pick<PricingInput, "brandId" | "categoryId">,
  rules: PricingRule[],
  override: PriceOverride | null,
): { level: RuleLevel; rule: PricingRule | null; override: PriceOverride | null } | null {
  if (override) return { level: "override", rule: null, override };
  if (input.categoryId === null) return null;
  const active = rules.filter((r) => r.active && r.categoryId === input.categoryId);
  if (input.brandId !== null) {
    const specific = active.find((r) => r.brandId === input.brandId);
    if (specific) return { level: "brand_category", rule: specific, override: null };
  }
  const fallback = active.find((r) => r.brandId === null);
  if (fallback) return { level: "category", rule: fallback, override: null };
  return null;
}

/** Actual Listing Cost = Item Price + Shipping — only when both are known and in one currency. */
export function totalCostMinor(input: Pick<PricingInput, "priceMinor" | "currency" | "shippingStatus" | "shippingMinor" | "shippingCurrency">): number | null {
  if (input.priceMinor === null) return null;
  if (input.shippingStatus === "free") return input.priceMinor;
  if (input.shippingStatus !== "fixed" || input.shippingMinor === null) return null;
  if (input.shippingCurrency && input.currency && input.shippingCurrency !== input.currency) return null;
  return input.priceMinor + input.shippingMinor;
}

export function decidePricing(input: PricingInput, rules: PricingRule[], override: PriceOverride | null, names: NamedLookup): PricingDecision {
  const currency = input.currency ?? "USD";
  const base: Omit<PricingDecision, "status" | "reason" | "explanation"> = {
    ruleLevel: null,
    ruleId: null,
    referenceRetailMinor: null,
    allowedBps: null,
    maxPriceMinor: null,
    itemMinor: input.priceMinor,
    shippingMinor: input.shippingStatus === "free" ? 0 : input.shippingMinor,
    totalMinor: totalCostMinor(input),
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
      explanation: `Needs pricing review: no active pricing rule for ${brand ? `${brand} / ` : ""}${cat} and no category-wide rule for ${cat}.`,
    };
  }

  const retail = selection.override?.referenceRetailMinor ?? selection.rule!.referenceRetailMinor;
  const bps = selection.override?.allowedBps ?? selection.rule!.allowedBps;
  const ruleCurrency = selection.override?.currency ?? selection.rule!.currency;
  const max = computeCeilingMinor(retail, bps);
  const levelText =
    selection.level === "override"
      ? "product override"
      : selection.level === "brand_category"
        ? `${names.brandName(input.brandId)} / ${names.categoryName(input.categoryId)} rule`
        : `${names.categoryName(input.categoryId)} category-wide rule`;
  const ceilingText = `${formatMoney(max, ruleCurrency)} ceiling (${formatBps(bps)} of ${formatMoney(retail, ruleCurrency)} retail · ${levelText})`;
  const withRule = {
    ...base,
    ruleLevel: selection.level,
    ruleId: selection.rule?.id ?? null,
    referenceRetailMinor: retail,
    allowedBps: bps,
    maxPriceMinor: max,
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
    if (!isWithinCeiling(input.priceMinor, retail, bps)) {
      return {
        ...withRule,
        status: "over_ceiling",
        reason: "item_alone_above_ceiling",
        explanation: `Over ceiling: item price ${formatMoney(input.priceMinor, currency)} alone exceeds the ${ceilingText}; shipping is unknown.${auctionNote}`,
      };
    }
    return {
      ...withRule,
      status: "needs_review",
      reason: "shipping_unknown",
      explanation: `Needs pricing review: item price ${formatMoney(input.priceMinor, currency)} is within the ${ceilingText}, but shipping cost is unknown${input.shippingStatus === "calculated" ? " (calculated at checkout)" : ""}. Shipping is never assumed to be free.${auctionNote}`,
    };
  }

  const shipping = input.shippingStatus === "free" ? 0 : input.shippingMinor!;
  const total = input.priceMinor + shipping;
  const breakdown = `${formatMoney(input.priceMinor, currency)} + ${shipping === 0 ? "free shipping" : `${formatMoney(shipping, currency)} shipping`}`;
  if (isWithinCeiling(total, retail, bps)) {
    return {
      ...withRule,
      shippingMinor: shipping,
      totalMinor: total,
      status: "eligible",
      reason: "within_ceiling",
      explanation: `Price-eligible: total ${formatMoney(total, currency)} (${breakdown}) is within the ${ceilingText}.${auctionNote}`,
    };
  }
  return {
    ...withRule,
    shippingMinor: shipping,
    totalMinor: total,
    status: "over_ceiling",
    reason: "above_ceiling",
    explanation: `Over ceiling: total ${formatMoney(total, currency)} (${breakdown}) exceeds the ${ceilingText} by ${formatMoney(total - max, currency)}.${auctionNote}`,
  };
}
