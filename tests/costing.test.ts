import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  decidePricing,
  formatPctOfRetail,
  pctOfRetailBps,
  pricingMaterialKeys,
  selectRule,
  type PricingInput,
  type PricingRule,
} from "../src/lib/pricing/engine";
import { findSellerStatedRetail } from "../src/lib/pricing/seller-retail";
import { FixtureProvider } from "../src/lib/providers/fixture/provider";
import { openDatabase, type AppDb } from "../src/server/db/client";
import * as s from "../src/server/db/schema";
import { runScan } from "../src/server/scanner/run";
import { createPricingRule, getPriceOverride, setPriceOverride, updatePricingSettings } from "../src/server/services/pricing";
import { brandId, categoryId, memoryDb, tempDbPath } from "./helpers";

const names = {
  brandName: (id: number | null) => (id === 1 ? "Brunello Cucinelli" : null),
  categoryName: (id: number | null) => (id === 10 ? "Sweaters & Knitwear" : null),
  materialName: (k: string | null) => (k === "cashmere" ? "Cashmere" : k === "cotton" ? "Cotton" : k),
};
const rule = (p: Partial<PricingRule>): PricingRule => ({
  id: Math.floor(Math.random() * 1e6),
  categoryId: 10,
  brandId: null,
  materialKey: null,
  referenceRetailMinor: 100000,
  currency: "USD",
  allowedBps: null,
  retailSource: null,
  active: true,
  ...p,
});
const input = (p: Partial<PricingInput> = {}): PricingInput => ({
  priceMinor: 30000,
  currency: "USD",
  shippingStatus: "fixed",
  shippingMinor: 1500,
  shippingCurrency: "USD",
  isAuction: false,
  brandId: 1,
  categoryId: 10,
  materialKeys: ["cashmere"],
  ...p,
});

describe("where the new price comes from", () => {
  const brandCashmere = rule({ brandId: 1, materialKey: "cashmere", referenceRetailMinor: 345000 });
  const brandAny = rule({ brandId: 1, referenceRetailMinor: 145000 });
  const catCashmere = rule({ materialKey: "cashmere", referenceRetailMinor: 120000 });
  const catAny = rule({ referenceRetailMinor: 50000 });
  const online = { id: 7, typicalMinor: 299500, currency: "USD", sourceCount: 5 };

  it("your listing price > brand+material > brand > online > category+material > category", () => {
    const all = [catAny, catCashmere, brandAny, brandCashmere];
    expect(selectRule(input(), all, { referenceRetailMinor: 1, allowedBps: null, currency: "USD", retailSource: null })?.level).toBe("override");
    expect(selectRule(input({ online }), all, null)?.level).toBe("brand_category_material");
    expect(selectRule(input({ online, materialKeys: ["cotton"] }), all, null)?.level).toBe("brand_category");
    expect(selectRule(input({ online }), [catAny, catCashmere], null)?.level).toBe("online");
    expect(selectRule(input(), [catAny, catCashmere], null)?.level).toBe("category_material");
    expect(selectRule(input({ materialKeys: [] }), [catAny, catCashmere], null)?.level).toBe("category");
  });

  it("uses the listing's main material first", () => {
    const reading = {
      blendKeys: [],
      components: [
        { key: "wool", pct: 30, source: "item_specifics" as const },
        { key: "cashmere", pct: 70, source: "item_specifics" as const },
        { key: "merino_wool", pct: null, source: "title" as const, implied: true },
      ],
    };
    expect(pricingMaterialKeys(reading)).toEqual(["cashmere", "wool", "merino_wool"]);
    expect(pricingMaterialKeys({ blendKeys: ["silk_cotton_blend"], components: [{ key: "silk", pct: null, source: "title" }] })).toEqual(["silk_cotton_blend", "silk"]);
    expect(pricingMaterialKeys(undefined)).toEqual([]);
  });

  it("an online price is labeled and uses your default %", () => {
    const d = decidePricing(input({ online }), [catAny], null, names, { defaultAllowedBps: 3300 });
    expect(d).toMatchObject({ ruleLevel: "online", retailLookupId: 7, referenceRetailMinor: 299500, allowedBps: 3300, usesDefaultBps: true, status: "eligible" });
    expect(d.explanation).toMatch(/typical new price online, 5 sources/);
    expect(d.explanation).toMatch(/33% of \$2,995\.00 retail · typical new price online, 5 sources · your default %/);
  });
});

describe("% of retail", () => {
  it("is total ÷ new price, rounded up, and agrees exactly with the ceiling", () => {
    const d = decidePricing(input(), [rule({ allowedBps: 3300 })], null, names);
    expect(d.pctOfRetailBps).toBe(pctOfRetailBps(31500, 100000)); // 31.5%
    expect(d.pctOfRetailBps).toBe(3150);
    expect(formatPctOfRetail(d.pctOfRetailBps)).toBe("32%"); // never understated
    for (const total of [32999, 33000, 33001]) {
      const x = decidePricing(input({ priceMinor: total, shippingStatus: "free" }), [rule({ allowedBps: 3300 })], null, names);
      expect(x.pctOfRetailBps! <= 3300).toBe(x.status === "eligible");
    }
  });

  it("covers the item only (marked) when shipping is unknown, and is empty without a price", () => {
    const d = decidePricing(input({ shippingStatus: "calculated", shippingMinor: null }), [rule({})], null, names);
    expect(d).toMatchObject({ pctOfRetailBps: 3000, pctIsLowerBound: true, status: "needs_review" });
    expect(formatPctOfRetail(d.pctOfRetailBps, d.pctIsLowerBound)).toBe("30%+");
    expect(decidePricing(input({ priceMinor: null }), [rule({})], null, names).pctOfRetailBps).toBeNull();
  });
});

describe("seller-stated retail (a claim, never used automatically)", () => {
  const found = (title: string, description = "") => findSellerStatedRetail({ title, description })?.minor ?? null;
  it("finds common phrasings", () => {
    expect(found("Brunello Cucinelli Cardigan XL Retail $3,450")).toBe(345000);
    expect(found("Kiton shirt", "MSRP: $895.00. Worn twice.")).toBe(89500);
    expect(found("NWT Isaia blazer $2,950 retail")).toBe(295000);
    expect(found("Loro Piana polo", "Retails for $1,150 in stores.")).toBe(115000);
    expect(found("Drake's jacket", "Originally $1,200")).toBe(120000);
  });
  it("ignores look-alikes and implausible amounts", () => {
    expect(found("Retail store closing — $40 shirt")).toBeNull();
    expect(found("Tee retail $5")).toBeNull();
    expect(found("Original box included, $300")).toBeNull();
    expect(found("Asking $450 or best offer")).toBeNull();
  });
});

describe("costing in the app", () => {
  it("your default % applies wherever a % is blank, and changing it re-prices listings", async () => {
    const { db } = memoryDb();
    await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test" });
    const knit = categoryId(db, "knitwear");
    const bc = brandId(db, "Brunello Cucinelli");
    createPricingRule(db, { categoryId: knit, brandId: bc, referenceRetailMinor: 145000, allowedBps: null });
    createPricingRule(db, { categoryId: knit, brandId: bc, materialKey: "cashmere", referenceRetailMinor: 345000, allowedBps: null });
    const decision = () => decisionFor(db, "FX-602"); // Brunello Cucinelli 100% cashmere cardigan, $420 free shipping
    expect(decision()).toMatchObject({ ruleLevel: "brand_category_material", referenceRetailMinor: 345000, allowedBps: 3300, usesDefaultBps: true, pctOfRetailBps: 1218 });
    expect(decision()!.sellerRetailMinor).toBe(345000); // "Retail $3,450" in the description (stored, not used)
    updatePricingSettings(db, { defaultAllowedBps: 1000 });
    expect(decision()).toMatchObject({ allowedBps: 1000, status: "over_ceiling" });
    expect(() => updatePricingSettings(db, { defaultAllowedBps: 0 })).toThrow(/between 1% and 100%/);
  });

  it("a listing price set without notes keeps the notes you had", () => {
    const { db } = memoryDb();
    setPriceOverride(db, "fixture", "FX-1", { referenceRetailMinor: 50000, allowedBps: 3000, notes: "checked in store" });
    setPriceOverride(db, "fixture", "FX-1", { referenceRetailMinor: 52000, allowedBps: null });
    expect(getPriceOverride(db, "fixture", "FX-1")).toMatchObject({ referenceRetailMinor: 52000, allowedBps: null, notes: "checked in store" });
  });
});

describe("upgrading a database from the previous version", () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.MIGRATIONS_DIR;
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("keeps your rules and listing prices (and their %) through the pricing migration", () => {
    // Migrations folder as it was before this change (0000–0003).
    const old = fs.mkdtempSync(path.join(os.tmpdir(), "ebay-finder-mig-"));
    dirs.push(old);
    const src = path.join(process.cwd(), "drizzle");
    const journal = JSON.parse(fs.readFileSync(path.join(src, "meta", "_journal.json"), "utf8"));
    const keep = journal.entries.filter((e: { idx: number }) => e.idx <= 3);
    fs.mkdirSync(path.join(old, "meta"));
    fs.writeFileSync(path.join(old, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: keep }));
    for (const e of keep) fs.copyFileSync(path.join(src, `${e.tag}.sql`), path.join(old, `${e.tag}.sql`));

    const file = tempDbPath();
    process.env.MIGRATIONS_DIR = old;
    let h = openDatabase(file);
    const shirts = h.db.select().from(s.categories).where(eq(s.categories.slug, "shirts")).get()!.id;
    h.sqlite.prepare("insert into pricing_rules (category_id, brand_id, reference_retail_minor, allowed_bps, retail_source) values (?, null, 15000, 4000, 'mine')").run(shirts);
    h.sqlite.prepare("insert into price_overrides (source, external_id, reference_retail_minor, allowed_bps, notes) values ('fixture', 'FX-101', 9900, 3500, 'n')").run();
    h.sqlite.close();

    delete process.env.MIGRATIONS_DIR;
    h = openDatabase(file); // now with the new migration
    expect(h.db.select().from(s.pricingRules).get()).toMatchObject({ categoryId: shirts, materialKey: null, referenceRetailMinor: 15000, allowedBps: 4000, retailSource: "mine" });
    expect(h.db.select().from(s.priceOverrides).where(and(eq(s.priceOverrides.source, "fixture"), eq(s.priceOverrides.externalId, "FX-101"))).get()).toMatchObject({
      referenceRetailMinor: 9900,
      allowedBps: 3500,
      notes: "n",
    });
    h.sqlite.close();
  });
});

function decisionFor(db: AppDb, externalId: string) {
  return db
    .select({ d: s.pricingDecisions })
    .from(s.pricingDecisions)
    .innerJoin(s.listings, eq(s.listings.id, s.pricingDecisions.listingId))
    .where(eq(s.listings.externalId, externalId))
    .get()?.d;
}
