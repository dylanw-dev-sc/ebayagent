import { eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { readColors } from "../src/lib/matching/color";
import { evaluateListing } from "../src/lib/matching/engine";
import { mapItemDetail } from "../src/lib/providers/ebay/mapper";
import { FixtureProvider } from "../src/lib/providers/fixture/provider";
import type { AppDb } from "../src/server/db/client";
import * as s from "../src/server/db/schema";
import { seedColors } from "../src/server/db/seed-data";
import { applySeedUpgrades } from "../src/server/db/seed";
import { runScan } from "../src/server/scanner/run";
import { loadColors } from "../src/server/services/context";
import { getFeed } from "../src/server/services/feed";
import { createColor, updateColor, ValidationError } from "../src/server/services/preferences";
import { ctxFor, listing, memoryDb } from "./helpers";

const COLORS = seedColors.map((c) => ({ ...c, priority: "neutral" as const }));
const read = (title: string, colorAspect: string | null = null, ignore: string[] = []) => readColors({ title, colorAspect }, COLORS, ignore);

function setColor(db: AppDb, key: string, priority: "prefer" | "neutral" | "avoid" | "exclude") {
  const row = db.select().from(s.colors).where(eq(s.colors.key, key)).get()!;
  updateColor(db, row.id, { priority });
}

describe("reading colors", () => {
  it("finds colors in the title, preferring the longest phrase", () => {
    expect(read("Sunspel Classic Crew Neck T-Shirt Navy Size L")).toMatchObject({ keys: ["navy"], source: "title" });
    expect(read("Navy Blue Oxford Shirt XL").keys).toEqual(["navy"]);
    expect(read("Light Blue Linen Shirt L").keys).toEqual(["light_blue"]);
    expect(read("Navy and White Stripe Shirt L").keys).toEqual(["navy", "white"]);
    expect(read("Heather Gray Tee").keys).toEqual(["grey"]);
  });

  it("drops a general color when a specific shade of it is named", () => {
    expect(read("Charcoal Grey Flannel Blazer 44R").keys).toEqual(["charcoal"]);
    expect(read("Kiton Roll Neck Sweater Size 52 Navy", "Blue")).toMatchObject({ keys: ["navy"], source: "both", aspect: "Blue" });
  });

  it("uses the Color item specific when the title names no color, and keeps real conflicts", () => {
    expect(read("John Smedley Crew Neck Sweater L", "Gray")).toMatchObject({ keys: ["grey"], source: "item_specifics" });
    expect(read("Isaia Sport Coat 44R Navy", "Black").keys).toEqual(["navy", "black"]);
    expect(read("Polo Shirt L", "Heather")).toMatchObject({ keys: [], source: "none", aspect: "Heather" });
  });

  it("ignores brand names, label lines and fabric names that contain color words", () => {
    expect(read("Ralph Lauren Purple Label Cashmere Sweater L", null, ["Ralph Lauren Purple Label"]).keys).toEqual([]);
    expect(read("Ralph Lauren Black Label Wool Blazer 44R").keys).toEqual([]);
    expect(read("Camel Hair Sport Coat 44R").keys).toEqual([]);
    expect(read("Camel Overcoat 44R").keys).toEqual(["camel"]);
    expect(read("Mint Condition Polo Shirt L").keys).toEqual([]);
  });
});

describe("color preferences in decisions", () => {
  const sweater = (title: string, extra: Partial<Parameters<typeof listing>[0]> = {}) =>
    listing({ title, brandAspect: "Kiton", sizeAspect: "L", materialAspect: "100% Cashmere", ebayCategoryIds: ["11484"], ...extra });

  it("excludes a listing whose only color you excluded, and reviews mixed colors", () => {
    const { db } = memoryDb();
    setColor(db, "navy", "exclude");
    const ctx = ctxFor(db);
    const only = evaluateListing(sweater("Kiton Cashmere Crewneck Sweater L Navy"), ctx);
    expect(only.state).toBe("no_match");
    expect(only.summary).toBe("Excluded: color is navy, which you excluded.");
    const mixed = evaluateListing(sweater("Kiton Cashmere Sweater L Navy and White Stripe"), ctx);
    expect(mixed.state).toBe("review");
    expect(mixed.summary).toMatch(/colors are navy and white; you excluded navy/);
    const none = evaluateListing(sweater("Kiton Cashmere Crewneck Sweater L"), ctx);
    expect(none.state).toBe("match"); // no color stated: never penalized
  });

  it("prefer and avoid change ranking only, and say so", () => {
    const { db } = memoryDb();
    setColor(db, "brown", "prefer");
    setColor(db, "black", "avoid");
    const ctx = ctxFor(db);
    const brown = evaluateListing(sweater("Kiton Cashmere Sweater L Brown"), ctx);
    expect(brown).toMatchObject({ state: "match", colorScore: 1 });
    expect(brown.summary).toMatch(/Color is brown, which you prefer\./);
    const black = evaluateListing(sweater("Kiton Cashmere Sweater L Black"), ctx);
    expect(black).toMatchObject({ state: "match", colorScore: -1 });
    expect(black.summary).toMatch(/Note: color is black, which you generally avoid; ranked lower\./);
  });

  it("a stored listing is re-evaluated as soon as you change a color", async () => {
    const { db } = memoryDb();
    await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test" });
    const evalOf = () =>
      db
        .select({ state: s.listingEvaluations.state, summary: s.listingEvaluations.summary, colorSummary: s.listingEvaluations.colorSummary })
        .from(s.listingEvaluations)
        .innerJoin(s.listings, eq(s.listings.id, s.listingEvaluations.listingId))
        .where(eq(s.listings.externalId, "FX-101")) // "Sunspel Classic Crew Neck T-Shirt Navy Size L"
        .get()!;
    expect(evalOf()).toMatchObject({ state: "match", colorSummary: "Navy" });
    setColor(db, "navy", "exclude");
    expect(evalOf()).toMatchObject({ state: "no_match", summary: "Excluded: color is navy, which you excluded." });
    setColor(db, "navy", "neutral");
    expect(evalOf().state).toBe("match");
  });
});

describe("color filter and sort", () => {
  it("filters by color and sorts preferred colors first", async () => {
    const { db } = memoryDb();
    await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test" });
    setColor(db, "green", "prefer");
    const base = { view: "all" as const, page: 1, pageSize: 500 };
    const navy = getFeed(db, { ...base, sort: "newest", color: "navy" }, "fixture").items;
    expect(navy.length).toBeGreaterThan(0);
    expect(navy.every((i) => i.colorSummary?.includes("Navy"))).toBe(true);
    const byColor = getFeed(db, { ...base, sort: "color" }, "fixture").items;
    expect(byColor[0].colorSummary).toMatch(/Green/);
  });
});

describe("managing colors", () => {
  it("validates names and words", () => {
    const { db } = memoryDb();
    expect(() => createColor(db, { name: "Navy" })).toThrow(ValidationError);
    const id = createColor(db, { name: "Teal", keywords: ["teal", "petrol blue"], priority: "prefer" });
    expect(loadColors(db).find((c) => c.id === id)).toMatchObject({ key: "teal", keywords: ["teal", "petrol blue"], priority: "prefer" });
    expect(() => updateColor(db, id, { keywords: [" "] })).toThrow(/at least one word/);
  });

  it("existing databases get the color list once, all Neutral", () => {
    const { db } = memoryDb();
    db.delete(s.colors).run();
    db.delete(s.meta).where(like(s.meta.key, "upgrade_%")).run();
    expect(applySeedUpgrades(db).changed).toBe(true);
    expect(loadColors(db)).toHaveLength(seedColors.length);
    expect(loadColors(db).every((c) => c.priority === "neutral")).toBe(true);
    db.delete(s.colors).where(eq(s.colors.key, "pink")).run(); // you delete one…
    applySeedUpgrades(db);
    expect(loadColors(db).some((c) => c.key === "pink")).toBe(false); // …and it stays deleted
  });
});

describe("eBay item details", () => {
  it("keep the top-level color with the item specifics", () => {
    const item = { itemId: "v1|123|0", title: "Isaia Sport Coat 44R", color: "Navy", localizedAspects: [{ name: "Brand", value: "Isaia" }] };
    expect(mapItemDetail(item)!.aspects).toContainEqual({ name: "Color", value: "Navy" });
    const withAspect = { ...item, localizedAspects: [{ name: "Color", value: "Blue" }] };
    expect(mapItemDetail(withAspect)!.aspects.filter((a) => a.name === "Color")).toEqual([{ name: "Color", value: "Blue" }]);
  });
});
