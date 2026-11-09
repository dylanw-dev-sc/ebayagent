import { describe, expect, it } from "vitest";
import { computeCeilingMinor, formatMoney, isWithinCeiling, parseMoneyToMinor, parsePercentToBps } from "../src/lib/money";
import { decidePricing, selectRule, type PricingInput, type PricingRule } from "../src/lib/pricing/engine";

const names = {
  brandName: (id: number | null) => (id === 1 ? "Brunello Cucinelli" : id === 2 ? "Kiton" : null),
  categoryName: (id: number | null) => (id === 10 ? "Shirts" : id === 20 ? "Jackets & Outerwear" : null),
};

const categoryRule: PricingRule = { id: 100, categoryId: 10, brandId: null, materialKey: null, referenceRetailMinor: 15000, currency: "USD", allowedBps: 4000, retailSource: "user", active: true };
const brandRule: PricingRule = { id: 101, categoryId: 10, brandId: 1, materialKey: null, referenceRetailMinor: 20000, currency: "USD", allowedBps: 4000, retailSource: "user", active: true };

const input = (p: Partial<PricingInput> = {}): PricingInput => ({
  priceMinor: 6500,
  currency: "USD",
  shippingStatus: "fixed",
  shippingMinor: 800,
  shippingCurrency: "USD",
  isAuction: false,
  brandId: 1,
  categoryId: 10,
  ...p,
});

describe("money handling", () => {
  it("parses decimal strings into integer cents without floating point errors", () => {
    expect(parseMoneyToMinor("65.00")).toBe(6500);
    expect(parseMoneyToMinor("0.10")).toBe(10);
    expect(parseMoneyToMinor("1,250.5")).toBe(125050);
    expect(parseMoneyToMinor("$80")).toBe(8000);
    expect(parseMoneyToMinor("19.999")).toBe(2000);
    expect(parseMoneyToMinor("abc")).toBeNull();
    expect(parseMoneyToMinor("")).toBeNull();
  });
  it("parses percentages to basis points", () => {
    expect(parsePercentToBps("40")).toBe(4000);
    expect(parsePercentToBps("37.5%")).toBe(3750);
    expect(parsePercentToBps("x")).toBeNull();
  });
  it("computes ceilings exactly", () => {
    expect(computeCeilingMinor(20000, 4000)).toBe(8000);
    expect(computeCeilingMinor(19999, 4000)).toBe(7999); // $79.996 → displayed $79.99 (rounded down)
    expect(formatMoney(7999)).toBe("$79.99");
  });
});

describe("the documented example", () => {
  it("retail $200 × 40% = $80 max; $65 + $8 = $73 → pass", () => {
    const d = decidePricing(input(), [brandRule], null, names);
    expect(d.maxPriceMinor).toBe(8000);
    expect(d.totalMinor).toBe(7300);
    expect(d.status).toBe("eligible");
    expect(d.explanation).toContain("$73.00");
    expect(d.explanation).toContain("$80.00");
  });
});

describe("price threshold boundaries", () => {
  it("exactly at the ceiling passes; one cent over fails", () => {
    expect(decidePricing(input({ priceMinor: 7200 }), [brandRule], null, names).status).toBe("eligible"); // 72 + 8 = 80
    const over = decidePricing(input({ priceMinor: 7201 }), [brandRule], null, names);
    expect(over.status).toBe("over_ceiling");
    expect(over.explanation).toContain("by $0.01");
  });
  it("exact comparison avoids rounding errors on fractional ceilings", () => {
    expect(isWithinCeiling(7999, 19999, 4000)).toBe(true);
    expect(isWithinCeiling(8000, 19999, 4000)).toBe(false);
  });
});

describe("shipping affects total cost", () => {
  it("the same item price passes with free shipping but fails with costly shipping", () => {
    expect(decidePricing(input({ priceMinor: 7500, shippingStatus: "free", shippingMinor: 0 }), [brandRule], null, names).status).toBe("eligible");
    expect(decidePricing(input({ priceMinor: 7500, shippingMinor: 1000 }), [brandRule], null, names).status).toBe("over_ceiling");
  });
});

describe("missing shipping information", () => {
  it("unknown shipping is never assumed free → needs pricing review", () => {
    const d = decidePricing(input({ shippingStatus: "unknown", shippingMinor: null }), [brandRule], null, names);
    expect(d.status).toBe("needs_review");
    expect(d.reason).toBe("shipping_unknown");
    expect(d.totalMinor).toBeNull(); // total is unknown — never computed as if shipping were free
    expect(d.explanation).toMatch(/never assumed to be free/);
  });
  it("calculated shipping is unknown too", () => {
    expect(decidePricing(input({ shippingStatus: "calculated", shippingMinor: null }), [brandRule], null, names).reason).toBe("shipping_unknown");
  });
  it("if the item price alone exceeds the ceiling, it is over regardless of shipping", () => {
    const d = decidePricing(input({ priceMinor: 9000, shippingStatus: "unknown", shippingMinor: null }), [brandRule], null, names);
    expect(d.status).toBe("over_ceiling");
    expect(d.reason).toBe("item_alone_above_ceiling");
  });
});

describe("missing retail baselines", () => {
  it("no applicable rule → needs pricing review", () => {
    const d = decidePricing(input({ categoryId: 20, brandId: 2 }), [brandRule, categoryRule], null, names);
    expect(d.status).toBe("needs_review");
    expect(d.reason).toBe("no_rule");
    expect(d.explanation).toContain("Kiton / Jackets & Outerwear");
  });
  it("still reports the actual total cost when no rule applies", () => {
    expect(decidePricing(input({ categoryId: 20, brandId: 2 }), [], null, names).totalMinor).toBe(7300);
  });
  it("unknown category → needs pricing review", () => {
    expect(decidePricing(input({ categoryId: null }), [categoryRule], null, names).reason).toBe("no_category");
  });
});

describe("pricing rule precedence", () => {
  it("product override > brand/category rule > category-wide rule", () => {
    const override = { referenceRetailMinor: 50000, allowedBps: 2000, currency: "USD", retailSource: "tag photo" };
    expect(selectRule({ brandId: 1, categoryId: 10 }, [categoryRule, brandRule], override)?.level).toBe("override");
    expect(selectRule({ brandId: 1, categoryId: 10 }, [categoryRule, brandRule], null)?.level).toBe("brand_category");
    expect(selectRule({ brandId: 2, categoryId: 10 }, [categoryRule, brandRule], null)?.level).toBe("category");
    expect(selectRule({ brandId: null, categoryId: 10 }, [categoryRule, brandRule], null)?.level).toBe("category");
  });
  it("inactive rules are ignored and fall back", () => {
    const inactive = { ...brandRule, active: false };
    const d = decidePricing(input(), [inactive, categoryRule], null, names);
    expect(d.ruleLevel).toBe("category");
    expect(d.maxPriceMinor).toBe(6000);
    expect(d.status).toBe("over_ceiling"); // 73 > 60
  });
  it("override changes the outcome", () => {
    const d = decidePricing(input(), [brandRule], { referenceRetailMinor: 10000, allowedBps: 5000, currency: "USD", retailSource: null }, names);
    expect(d.ruleLevel).toBe("override");
    expect(d.maxPriceMinor).toBe(5000);
    expect(d.status).toBe("over_ceiling");
  });
});

describe("currencies", () => {
  it("does not compare different currencies without conversion", () => {
    const d = decidePricing(input({ currency: "EUR", shippingCurrency: "EUR" }), [brandRule], null, names);
    expect(d.status).toBe("needs_review");
    expect(d.reason).toBe("currency_mismatch");
  });
});

describe("auctions", () => {
  it("notes that auctions are evaluated on the current bid", () => {
    expect(decidePricing(input({ isAuction: true }), [brandRule], null, names).explanation).toMatch(/current bid/);
  });
});
