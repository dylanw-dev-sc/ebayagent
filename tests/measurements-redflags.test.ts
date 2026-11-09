import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { evaluateListing } from "../src/lib/matching/engine";
import { judgeMeasurements, readMeasurements } from "../src/lib/matching/measurements";
import { DEFAULT_RED_FLAG_PHRASES, findRedFlags } from "../src/lib/matching/red-flags";
import { FixtureProvider } from "../src/lib/providers/fixture/provider";
import * as s from "../src/server/db/schema";
import { runScan, sellerBelowMinimum } from "../src/server/scanner/run";
import { updateCategory, updateDefaults, updateScanSettings, ValidationError } from "../src/server/services/preferences";
import { setUserState } from "../src/server/services/user-state";
import { categoryId, ctxFor, EBAY_CAT, listing, memoryDb } from "./helpers";

const read = (description: string) => readMeasurements({ title: "", description }).values;

describe("reading garment measurements", () => {
  it("reads common formats, units and fractions", () => {
    expect(read("Measurements (flat): Pit to pit 22.5 in, shoulders 18 in, sleeve 25 in, length 27 in.")).toEqual({ chest: 22.5, shoulders: 18, sleeve: 25, length: 27 });
    expect(read('P2P: 23" Length: 30 1/2"')).toEqual({ chest: 23, length: 30.5 });
    expect(read("Great jacket. Armpit to armpit – 21½ inches")).toEqual({ chest: 21.5 });
    expect(read("23 in pit to pit, 30 in length")).toEqual({ chest: 23, length: 30 });
    expect(read("Measurements: pit to pit 22, length 29")).toEqual({ chest: 22, length: 29 });
  });

  it("converts centimetres and chest circumferences", () => {
    expect(read("Pit-to-pit approx. 56 cm. Back length 74cm.")).toEqual({ chest: 22, length: 29.1 });
    expect(read("Chest 46 inches around")).toEqual({ chest: 23 });
  });

  it("ignores size labels and center-back sleeves instead of guessing", () => {
    expect(read("Size 44 chest regular, sleeve 34")).toEqual({});
    expect(read("Sleeve 34 (center back)")).toEqual({});
  });

  it("judges against your ranges", () => {
    const ranges = { chest: { min: 22, max: 23.5 }, length: { min: 26, max: 31 } };
    expect(judgeMeasurements(readMeasurements({ title: "", description: "pit to pit 22.5 in, length 27 in" }), ranges).verdict).toBe("fits");
    const misfit = judgeMeasurements(readMeasurements({ title: "", description: "pit to pit 21 in" }), ranges);
    expect(misfit).toEqual({ verdict: "misfit", message: "pit to pit 21 in is below your 22–23.5 in range" });
    expect(judgeMeasurements(readMeasurements({ title: "", description: "length 30 in" }), ranges).verdict).toBe("inconclusive"); // chest required
    expect(judgeMeasurements(readMeasurements({ title: "", description: "pit to pit 23 in" }), {}).verdict).toBe("not_configured");
  });
});

describe("measurements settle unclear sizes", () => {
  const { db } = memoryDb();
  const jackets = categoryId(db, "jackets-outerwear");
  updateCategory(db, jackets, { measurementRanges: { chest: { min: 22, max: 23.5 } } });
  const ctx = ctxFor(db);
  const jacket = (sizeAspect: string | null, description: string | null) =>
    evaluateListing(listing({ title: "Isaia sport coat", brandAspect: "Isaia", sizeAspect, materialAspect: "100% Wool", ebayCategoryIds: [EBAY_CAT.tailored], description }), ctx);

  it("unclear label + measurements that fit → match", () => {
    const ev = jacket("IT 54", "Pit to pit 22.5 in");
    expect(ev.state).toBe("match");
    expect(ev.summary).toMatch(/jacket measurements that fit you \(pit to pit 22\.5 in; labeled EU 54\)/);
  });

  it("unclear label + measurements outside your range → excluded", () => {
    const ev = jacket("54", "Pit to pit 21 inches");
    expect(ev.state).toBe("no_match");
    expect(ev.summary).toBe("Excluded: jacket pit to pit 21 in is below your 22–23.5 in range.");
  });

  it("label and measurements disagree → review", () => {
    expect(jacket("44R", "pit to pit 25 in").state).toBe("review");
    expect(jacket("40R", "pit to pit 23 in").state).toBe("review");
  });

  it("no measurements → the size label decides as before", () => {
    expect(jacket("44R", null).state).toBe("match");
    expect(jacket("IT 54", null).state).toBe("review");
  });

  it("validates ranges", () => {
    expect(() => updateCategory(db, jackets, { measurementRanges: { chest: { min: 24, max: 22 } } })).toThrow(ValidationError);
    expect(() => updateCategory(db, jackets, { measurementRanges: { chest: { min: 300, max: null } } })).toThrow(ValidationError);
  });
});

describe("counterfeit red flags", () => {
  it("finds red-flag phrases, ignoring negated mentions", () => {
    expect(findRedFlags({ title: "Polo Shirt Inspired By Loro Piana Size L", description: null }, DEFAULT_RED_FLAG_PHRASES)).toEqual(["inspired by"]);
    expect(findRedFlags({ title: "Kiton jacket 1:1 replica", description: null }, DEFAULT_RED_FLAG_PHRASES)).toEqual(["replica", "1:1"]);
    expect(findRedFlags({ title: "Loro Piana polo", description: "100% authentic, not a replica. No fakes." }, DEFAULT_RED_FLAG_PHRASES)).toEqual([]);
    expect(findRedFlags({ title: "Kiton jacket size 1 1", description: null }, DEFAULT_RED_FLAG_PHRASES)).toEqual([]);
  });

  it("excludes by default; can send to review or just warn", () => {
    const { db } = memoryDb();
    const fake = () =>
      evaluateListing(
        listing({ title: "Polo Shirt Inspired By Loro Piana Size L", brandAspect: "Unbranded", sizeAspect: "L", materialAspect: "100% Cotton", ebayCategoryIds: [EBAY_CAT.polo] }),
        ctxFor(db),
      );
    expect(fake().state).toBe("no_match");
    expect(fake().summary).toBe("Excluded: contains “inspired by”, a counterfeit red flag.");
    updateDefaults(db, { redFlagPolicy: "review" });
    expect(fake().state).toBe("review");
    updateDefaults(db, { redFlagPolicy: "flag" });
    expect(fake().state).toBe("match");
    expect(fake().profiles[0].reasons.some((r) => r.dimension === "authenticity" && r.effect === "info")).toBe(true);
  });
});

describe("seller feedback minimums (applied during scans, never stored)", () => {
  it("unknown feedback never counts against a listing", () => {
    const settings = { minSellerFeedbackScore: 10, minSellerFeedbackPercent: 98 };
    expect(sellerBelowMinimum({ sellerFeedbackScore: 3, sellerFeedbackPercent: 100 }, settings)).toBe(true);
    expect(sellerBelowMinimum({ sellerFeedbackScore: 500, sellerFeedbackPercent: 95.2 }, settings)).toBe(true);
    expect(sellerBelowMinimum({ sellerFeedbackScore: 500, sellerFeedbackPercent: 99.9 }, settings)).toBe(false);
    expect(sellerBelowMinimum({}, settings)).toBe(false);
    expect(sellerBelowMinimum({ sellerFeedbackScore: 3 }, { minSellerFeedbackScore: null, minSellerFeedbackPercent: null })).toBe(false);
  });

  it("skips low-feedback sellers in a scan and stores no seller data", async () => {
    const { db } = memoryDb();
    updateScanSettings(db, { minSellerFeedbackScore: 10 });
    const r = await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test" });
    expect(r.skippedSeller).toBe(1);
    expect(db.select().from(s.listings).where(and(eq(s.listings.source, "fixture"), eq(s.listings.externalId, "FX-121"))).get()).toBeUndefined();
    const columns = Object.keys(db.select().from(s.listings).get()!);
    expect(columns.some((c) => /seller/i.test(c))).toBe(false);
  });

  it("removes listings found before the minimum was set, unless you saved them", async () => {
    const stored = (db: ReturnType<typeof memoryDb>["db"], id: string) =>
      db.select().from(s.listings).where(and(eq(s.listings.source, "fixture"), eq(s.listings.externalId, id))).get();
    for (const keepSaved of [false, true]) {
      const { db } = memoryDb();
      await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test" });
      expect(stored(db, "FX-121")).toBeDefined();
      if (keepSaved) setUserState(db, "fixture", "FX-121", { saved: true });
      updateScanSettings(db, { minSellerFeedbackScore: 10 }); // also resets scan bookmarks → next scan covers the window again
      const r = await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test" });
      expect(r.skippedSeller).toBe(1);
      expect(stored(db, "FX-121") !== undefined).toBe(keepSaved);
      expect(r.purged).toBe(keepSaved ? 0 : 1);
    }
  });

  it("fixture scan: measurements and red flags decide real listings", async () => {
    const { db } = memoryDb();
    updateCategory(db, categoryId(db, "jackets-outerwear"), { measurementRanges: { chest: { min: 22, max: 23.5 } } });
    await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test" });
    const state = (id: string) =>
      db
        .select({ st: s.listingEvaluations.state })
        .from(s.listingEvaluations)
        .innerJoin(s.listings, eq(s.listings.id, s.listingEvaluations.listingId))
        .where(eq(s.listings.externalId, id))
        .get()?.st;
    expect(state("FX-301")).toBe("match"); // IT 54, pit to pit 22.5
    expect(state("FX-306")).toBe("no_match"); // "54", pit to pit 21
    expect(state("FX-304")).toBe("no_match"); // XL, P2P 24.5
    expect(state("FX-122")).toBe("no_match"); // "inspired by"
    expect(state("FX-104")).toBe("match"); // "not a replica" is not a red flag
  });
});
