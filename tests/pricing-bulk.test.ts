import { describe, expect, it } from "vitest";
import { FixtureProvider } from "../src/lib/providers/fixture/provider";
import * as s from "../src/server/db/schema";
import { runScan } from "../src/server/scanner/run";
import { createPricingRule } from "../src/server/services/pricing";
import { exportRulesCsv, importRulesCsv, parseCsv, RULE_CSV_HEADER, saveRuleGrid, toCsv } from "../src/server/services/pricing-bulk";
import { brandId, categoryId, memoryDb } from "./helpers";

describe("CSV helpers", () => {
  it("parses quoted fields, commas, newlines, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","He said ""hi"""\n"multi\nline",\n')).toEqual([
      ["a", "b"],
      ["x, y", 'He said "hi"'],
      ["multi\nline", ""],
    ]);
  });
  it("neutralizes spreadsheet formulas in text cells", () => {
    expect(toCsv([["=HYPERLINK(1)", "100"], ["Kiton", "-5"]], [1])).toBe("'=HYPERLINK(1),100\r\nKiton,-5\r\n");
  });
});

describe("pricing rules: CSV export / template / import", () => {
  it("exports a fill-in template with one row per enabled brand × category", () => {
    const { db } = memoryDb();
    const rows = parseCsv(exportRulesCsv(db, { template: true }));
    expect(rows[0]).toEqual(RULE_CSV_HEADER);
    expect(rows.length - 1).toBe(4 * (36 + 1)); // 4 categories × (36 brands + category-wide)
    expect(rows[1].slice(0, 4)).toEqual(["Button-Down Shirts", "All brands", "", ""]);
  });

  it("imports rules, skips blank rows, reports problems by line, and round-trips", () => {
    const { db } = memoryDb();
    const csv = [
      "category,brand,reference_retail_usd,allowed_percent,retail_source,notes,active",
      "Shirts,All brands,150,40,my notes,,yes",
      "shirts,APC,180,35%,apc.com,,",
      "Jackets & Outerwear,Kiton,6500,25,kiton.com,,no",
      "Shirts,Sunspel,,,,,",
      "Shirts,Kitn,100,40,,,",
      "Shirts,Eton,abc,40,,,",
      "Shirts,Eton,120,150,,,",
    ].join("\n");
    const r = importRulesCsv(db, csv);
    expect(r).toMatchObject({ created: 3, updated: 0, skipped: 1 });
    expect(r.errors).toEqual([
      "Line 6: unknown brand “Kitn”.",
      "Line 7: retail price “abc” isn't a valid amount.",
      "Line 8: allowed percent “150” must be between 0.01 and 100 (or blank for your default).",
    ]);
    const rules = db.select().from(s.pricingRules).all();
    expect(rules.find((x) => x.brandId === brandId(db, "A.P.C."))).toMatchObject({ referenceRetailMinor: 18000, allowedBps: 3500, retailSource: "apc.com" });
    expect(rules.find((x) => x.brandId === brandId(db, "Kiton"))!.active).toBe(false);
    expect(rules.find((x) => x.brandId === null)!.categoryId).toBe(categoryId(db, "shirts"));

    // Round trip: exporting and re-importing changes nothing.
    const again = importRulesCsv(db, exportRulesCsv(db, { template: false }));
    expect(again).toMatchObject({ created: 0, updated: 0, skipped: 3, errors: [] });
  });

  it("imports one-material prices and blank % (= your default), and exports them", () => {
    const { db } = memoryDb();
    const csv = [
      "category,brand,material,reference_retail_usd,allowed_percent",
      "Sweaters & Knitwear,Brunello Cucinelli,Cashmere,2950,",
      "Sweaters & Knitwear,Brunello Cucinelli,,1450,30",
      "Sweaters & Knitwear,Brunello Cucinelli,Velvet,1450,30",
      "Shirts,All,,100,", // "All" alone still means category-wide
    ].join("\n");
    const r = importRulesCsv(db, csv);
    expect(r.errors).toEqual(["Line 4: unknown material “Velvet”."]);
    expect(r.created).toBe(3);
    const rules = db.select().from(s.pricingRules).all();
    expect(rules.find((x) => x.materialKey === "cashmere")).toMatchObject({ referenceRetailMinor: 295000, allowedBps: null });
    expect(rules.find((x) => x.brandId !== null && x.materialKey === null)).toMatchObject({ referenceRetailMinor: 145000, allowedBps: 3000 });
    const out = parseCsv(exportRulesCsv(db, { template: false }));
    expect(out[0]).toEqual(RULE_CSV_HEADER);
    expect(out.find((row) => row[2] === "Cashmere")!.slice(3, 5)).toEqual(["2950.00", ""]);
  });

  it("rejects files without the required columns", () => {
    const { db } = memoryDb();
    expect(importRulesCsv(db, "brand,price\nKiton,100").errors[0]).toMatch(/Missing column/);
  });
});

describe("pricing rules: brand × category grid", () => {
  it("creates, updates and removes rules in one save, then recalculates prices", async () => {
    const { db } = memoryDb();
    await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test" });
    const shirts = categoryId(db, "shirts");
    const sunspel = brandId(db, "Sunspel");

    // A one-material price (cotton Sunspel shirts) — the grid must never touch it.
    createPricingRule(db, { categoryId: shirts, brandId: sunspel, materialKey: "cotton", referenceRetailMinor: 8500, allowedBps: null });

    let r = saveRuleGrid(
      db,
      [
        { categoryId: shirts, brandId: null, retailMinor: 10000, bps: null }, // blank % = your default
        { categoryId: shirts, brandId: sunspel, retailMinor: 9000, bps: 5000 },
      ],
      { retailSource: "grid" },
    );
    expect(r).toMatchObject({ created: 2, errors: [] });
    expect(db.select().from(s.pricingRules).all().find((x) => x.brandId === null)!.allowedBps).toBeNull();
    const decisions = db.select().from(s.pricingDecisions).all();
    expect(decisions.find((d) => d.ruleLevel === "category")).toMatchObject({ allowedBps: 3300, usesDefaultBps: true });
    expect(decisions.some((d) => d.ruleLevel === "brand_category")).toBe(true);

    r = saveRuleGrid(
      db,
      [
        { categoryId: shirts, brandId: null, retailMinor: null, bps: null }, // cleared → removed
        { categoryId: shirts, brandId: sunspel, retailMinor: null, bps: null }, // cleared → removed (cotton rule stays)
      ],
      { retailSource: null },
    );
    expect(r).toMatchObject({ deleted: 2 });
    expect(db.select().from(s.pricingRules).all().map((x) => x.materialKey)).toEqual(["cotton"]);

    r = saveRuleGrid(db, [{ categoryId: shirts, brandId: null, retailMinor: 12000, bps: 15000 }], { retailSource: null });
    expect(r.errors[0]).toMatch(/between 0.01 and 100/);
  });
});
