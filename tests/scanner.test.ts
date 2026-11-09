import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FIXTURE_ITEMS } from "../src/lib/providers/fixture/data";
import { FixtureProvider } from "../src/lib/providers/fixture/provider";
import type { ItemDetailResult, ListingProvider } from "../src/lib/providers/types";
import type { AppDb } from "../src/server/db/client";
import * as s from "../src/server/db/schema";
import { getRunningScan, recoverInterruptedScans, runScan, ScanInProgressError } from "../src/server/scanner/run";
import { updateCategory, updateScanSettings } from "../src/server/services/preferences";
import type { ProviderQuery, SearchPageRequest } from "../src/lib/providers/types";
import { createPricingRule, setPriceOverride, updatePricingRule } from "../src/server/services/pricing";
import { getFeed } from "../src/server/services/feed";
import { getUserState, setUserState } from "../src/server/services/user-state";
import { brandId, categoryId, memoryDb } from "./helpers";

// Fixture timestamps are relative to "now" so the rolling listing-age window never makes these tests date-dependent.
const NOW = new Date();
const fixture = (batch: number, extra: ConstructorParameters<typeof FixtureProvider>[0] = {}) => new FixtureProvider({ batch, now: NOW, ...extra });
const scan = (db: AppDb, provider: ListingProvider) => runScan(db, { provider, trigger: "test" });

function listingByExt(db: AppDb, externalId: string) {
  return db.select().from(s.listings).where(and(eq(s.listings.source, "fixture"), eq(s.listings.externalId, externalId))).get();
}
function evalByExt(db: AppDb, externalId: string) {
  const l = listingByExt(db, externalId);
  return l ? db.select().from(s.listingEvaluations).where(eq(s.listingEvaluations.listingId, l.id)).get() : undefined;
}
function pricingByExt(db: AppDb, externalId: string) {
  const l = listingByExt(db, externalId);
  return l ? db.select().from(s.pricingDecisions).where(eq(s.pricingDecisions.listingId, l.id)).get() : undefined;
}
const feed = (db: AppDb, view: Parameters<typeof getFeed>[1]["view"], extra: Partial<Parameters<typeof getFeed>[1]> = {}) =>
  getFeed(db, { view, sort: "newest", page: 1, pageSize: 500, ...extra }, "fixture");

describe("scanning, normalization and deduplication", () => {
  const { db } = memoryDb();
  let first: Awaited<ReturnType<typeof runScan>>;

  it("runs a complete fixture scan and records the run", async () => {
    first = await scan(db, fixture(1));
    expect(first.status).toBe("completed");
    expect(first.mode).toBe("fixture");
    expect(first.examined).toBeGreaterThan(0);
    expect(first.newListings).toBeGreaterThan(30);
    expect(first.matchedNew + first.reviewNew + first.rejectedNew).toBe(first.newListings);
    const run = db.select().from(s.scanRuns).where(eq(s.scanRuns.id, first.runId)).get()!;
    expect(run.status).toBe("completed");
    expect(run.finishedAt).not.toBeNull();
    expect(run.examined).toBe(first.examined);
  });

  it("deduplicates a listing found by several queries", () => {
    // FX-308 "Valstar for Todd Snyder…" is returned by both the Valstar and the Todd Snyder search.
    const rows = db.select().from(s.listings).where(eq(s.listings.externalId, "FX-308")).all();
    expect(rows).toHaveLength(1);
    expect(first.duplicates).toBeGreaterThan(0);
    const unique = new Set(db.select().from(s.listings).all().map((l) => l.externalId));
    expect(unique.size).toBe(db.select().from(s.listings).all().length);
  });

  it("does not store auctions unless enabled (eBay's default is Buy It Now only)", () => {
    expect(listingByExt(db, "FX-318")).toBeUndefined();
  });

  it("enriches candidates with item specifics and never invents missing fields", () => {
    const l = listingByExt(db, "FX-101")!;
    expect(l.detailsFetchedAt).not.toBeNull();
    expect(l.sizeAspect).toBe("L");
    const noDetails = listingByExt(db, "FX-111")!; // fixture without item specifics
    expect(noDetails.materialAspect).toBeNull();
    expect(noDetails.itemUrl).toBeNull();
    expect(first.detailCalls).toBeGreaterThan(0);
  });

  it("stores match decisions with the expected states", () => {
    expect(evalByExt(db, "FX-212")!.state).toBe("match");
    expect(evalByExt(db, "FX-103")!.state).toBe("review"); // no fabric
    expect(evalByExt(db, "FX-303")!.state).toBe("no_match"); // 40R
    expect(evalByExt(db, "FX-303")!.summary).toBe("Excluded: jacket is size 40R, your accepted size is 44R.");
    expect(evalByExt(db, "FX-105")!.state).toBe("no_match"); // RL Black Label in purple ≠ Purple Label
    expect(evalByExt(db, "FX-105")!.summary).toBe("Excluded: none of your brands appear in the title.");
    expect(evalByExt(db, "FX-304")!.state).toBe("review"); // XL jacket
    expect(evalByExt(db, "FX-307")!.state).toBe("review"); // Loro Piana fabric on Suitsupply
  });

  it("a listing matching several profiles appears once in the feed with all profiles recorded", () => {
    const ev = evalByExt(db, "FX-212")!;
    expect(ev.matchedProfileIds.length).toBe(3);
    const matches = feed(db, "matches").items.filter((i) => i.externalId === "FX-212");
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedProfileNames.sort()).toEqual(["All Preferences", "Luxury Shirts", "Premium Button-Downs"]);
  });

  it("records incremental watermarks per query", () => {
    const states = db.select().from(s.queryStates).all();
    expect(states.length).toBe(first.queriesPlanned);
    expect(states.every((q) => q.lastStatus === "ok")).toBe(true);
    expect(states.some((q) => q.watermarkAt !== null)).toBe(true);
  });

  it("second scan detects new, updated and unchanged listings", async () => {
    const before = db.select().from(s.listings).all().length;
    const second = await scan(db, fixture(2));
    expect(second.status).toBe("completed");
    expect(second.newListings).toBe(FIXTURE_ITEMS.filter((i) => i.batch === 2).length);
    expect(second.updatedListings).toBeGreaterThanOrEqual(1); // FX-101 price drop
    expect(second.unchangedListings).toBeGreaterThan(0);
    expect(listingByExt(db, "FX-101")!.priceMinor).toBe(3200);
    expect(db.select().from(s.listings).all().length).toBe(before + second.newListings);
  });
});

describe("seller descriptions", () => {
  it("reads fabric stated only in the description, ignoring packaging and boilerplate", async () => {
    const { db } = memoryDb();
    await scan(db, fixture(1));
    const ev = evalByExt(db, "FX-213")!;
    expect(ev.state).toBe("match");
    expect(ev.materialKeys).toEqual(["linen"]); // not polyester ("poly mailer") or cashmere ("my other cashmere sweaters")
    expect(listingByExt(db, "FX-213")!.descriptionText).toContain("100% linen");
    // A description without composition keeps the listing in review and says where the app looked.
    expect(evalByExt(db, "FX-103")!.summary).toBe(
      "Needs review: seller did not provide fabric composition (checked the title, item specifics and description).",
    );
    // Care-label photos are offered for manual checking, never read automatically.
    expect(listingByExt(db, "FX-103")!.additionalImages).toEqual(["/api/fixture-image/FX-103?view=label"]);
  });
});

describe("listing-age window (only recent postings)", () => {
  const oldSunspel = { ...FIXTURE_ITEMS.find((i) => i.id === "FX-101")!, id: "FX-OLD", hoursAgo: 24 * 10, title: "Sunspel Classic Crew Neck T-Shirt Grey Size L", revisions: [] };

  it("asks the source for listings posted within the window", async () => {
    const { db } = memoryDb();
    class Spy extends FixtureProvider {
      postedAfter: Array<Date | null | undefined> = [];
      async search(q: ProviderQuery, p: SearchPageRequest) {
        this.postedAfter.push(q.postedAfter);
        return super.search(q, p);
      }
    }
    const spy = new Spy({ batch: 1, now: NOW, items: [...FIXTURE_ITEMS, oldSunspel] });
    const r = await scan(db, spy);
    const expected = Date.now() - 7 * 86_400_000;
    expect(spy.postedAfter.length).toBeGreaterThan(0);
    expect(spy.postedAfter.every((d) => d instanceof Date && Math.abs(d.getTime() - expected) < 60_000)).toBe(true);
    expect(listingByExt(db, "FX-OLD")).toBeUndefined(); // filtered by the source
    expect(r.skippedOld).toBe(0);
  });

  it("skips old listings itself when the source ignores the date filter", async () => {
    const { db } = memoryDb();
    const r = await scan(db, fixture(1, { items: [...FIXTURE_ITEMS, oldSunspel], ignorePostedAfter: true }));
    expect(r.skippedOld).toBeGreaterThanOrEqual(1);
    expect(listingByExt(db, "FX-OLD")).toBeUndefined();
    expect(listingByExt(db, "FX-101")).toBeDefined();
    expect(db.select().from(s.scanRuns).where(eq(s.scanRuns.id, r.runId)).get()!.skippedOld).toBe(r.skippedOld);
  });

  it("hides listings that age out of the window, keeps saved ones, and removes unsaved ones on the next scan", async () => {
    const { db } = memoryDb();
    await scan(db, fixture(1));
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
    db.update(s.listings).set({ originAt: eightDaysAgo, listedAt: eightDaysAgo }).where(eq(s.listings.externalId, "FX-101")).run();
    db.update(s.listings).set({ originAt: eightDaysAgo, listedAt: eightDaysAgo }).where(eq(s.listings.externalId, "FX-102")).run();
    setUserState(db, "fixture", "FX-102", { saved: true });

    const all = feed(db, "all").items.map((i) => i.externalId);
    expect(all).not.toContain("FX-101");
    expect(all).not.toContain("FX-102");
    expect(feed(db, "saved").items.map((i) => i.externalId)).toEqual(["FX-102"]);

    await scan(db, fixture(1, { items: FIXTURE_ITEMS.filter((i) => i.id !== "FX-101" && i.id !== "FX-102") }));
    expect(listingByExt(db, "FX-101")).toBeUndefined(); // aged out, not saved → removed
    expect(listingByExt(db, "FX-102")).toBeDefined(); // saved → kept
  });

  it("changing the window resets scan bookmarks so the next scan covers it", async () => {
    const { db } = memoryDb();
    await scan(db, fixture(1));
    expect(db.select().from(s.queryStates).all().length).toBeGreaterThan(0);
    updateScanSettings(db, { maxListingAgeDays: 14 });
    expect(db.select().from(s.queryStates).all()).toHaveLength(0);
    expect(() => updateScanSettings(db, { maxListingAgeDays: 0 })).toThrow(/between 1 and 30/);
  });
});

describe("feed filters and sorting", () => {
  const { db } = memoryDb();
  it("filters by brand, category, size, material, pricing and review status; sorts by price", async () => {
    await scan(db, fixture(3));
    const sunspel = brandId(db, "Sunspel");
    expect(feed(db, "all", { brandId: sunspel }).items.every((i) => i.brandName === "Sunspel")).toBe(true);
    const jackets = categoryId(db, "jackets-outerwear");
    expect(feed(db, "all", { categoryId: jackets }).items.every((i) => i.categoryName === "Jackets & Outerwear")).toBe(true);
    expect(feed(db, "all", { size: "44R" }).items.every((i) => i.sizeLabel?.includes("44R"))).toBe(true);
    expect(feed(db, "all", { material: "suede" }).items.length).toBeGreaterThan(0);
    expect(feed(db, "all", { pricing: "needs_review" }).total).toBe(feed(db, "all").total); // no rules yet
    const asc = feed(db, "all", { sort: "price_asc" }).items.map((i) => i.totalMinor ?? i.priceMinor ?? 0);
    expect(asc.length).toBeGreaterThan(5);
    const desc = feed(db, "all", { sort: "price_desc" }).items;
    expect(desc[0].priceMinor).toBeGreaterThanOrEqual(desc[desc.length - 1].priceMinor ?? 0);
    const l = listingByExt(db, "FX-201")!;
    setUserState(db, "fixture", l.externalId, { reviewed: true });
    expect(feed(db, "all", { review: "reviewed" }).items.map((i) => i.externalId)).toEqual(["FX-201"]);
  });
});

describe("saved and dismissed states", () => {
  it("persist across repeat scans and purges, and control feed visibility", async () => {
    const { db } = memoryDb();
    await scan(db, fixture(1));
    setUserState(db, "fixture", "FX-102", { saved: true });
    setUserState(db, "fixture", "FX-212", { dismissed: true });
    await scan(db, fixture(2));
    expect(getUserState(db, "fixture", "FX-102")!.saved).toBe(true);
    expect(getUserState(db, "fixture", "FX-212")!.dismissed).toBe(true);
    expect(feed(db, "matches").items.map((i) => i.externalId)).not.toContain("FX-212");
    expect(feed(db, "dismissed").items.map((i) => i.externalId)).toEqual(["FX-212"]);
    expect(feed(db, "saved").items.map((i) => i.externalId)).toEqual(["FX-102"]);

    // Saving clears dismissal.
    setUserState(db, "fixture", "FX-212", { saved: true });
    expect(getUserState(db, "fixture", "FX-212")!.dismissed).toBe(false);

    // Retention purge deletes the listing content but keeps the decision; rediscovery reattaches it.
    db.update(s.listings).set({ lastSeenAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(s.listings.externalId, "FX-102")).run();
    await scan(db, fixture(2, { items: FIXTURE_ITEMS.filter((i) => i.id !== "FX-102") }));
    expect(listingByExt(db, "FX-102")).toBeUndefined();
    expect(getUserState(db, "fixture", "FX-102")!.saved).toBe(true);
    await scan(db, fixture(2));
    expect(listingByExt(db, "FX-102")).toBeDefined();
    expect(feed(db, "saved").items.map((i) => i.externalId)).toContain("FX-102");
  });
});

describe("recalculation after rule changes (no API calls)", () => {
  it("pricing rules, precedence and preference changes recalculate stored listings", async () => {
    const { db } = memoryDb();
    const provider = fixture(1);
    await scan(db, provider);
    const callsAfterScan = provider.callCount;
    const shirts = categoryId(db, "shirts");
    const bc = brandId(db, "Brunello Cucinelli");

    expect(pricingByExt(db, "FX-101")!.status).toBe("needs_review");
    expect(pricingByExt(db, "FX-101")!.reason).toBe("no_rule");

    const ruleId = createPricingRule(db, { categoryId: shirts, brandId: null, referenceRetailMinor: 10000, allowedBps: 5000, retailSource: "test" });
    // Sunspel tee: $38 + $5 = $43 ≤ $50 → eligible.
    expect(pricingByExt(db, "FX-101")!.status).toBe("eligible");
    // Drake's tee: calculated shipping → needs review, never assumed free.
    expect(pricingByExt(db, "FX-112")!.reason).toBe("shipping_unknown");

    updatePricingRule(db, ruleId, { allowedBps: 3000 }); // $30 ceiling
    expect(pricingByExt(db, "FX-101")!.status).toBe("over_ceiling");

    // Brand/category rule beats category-wide.
    createPricingRule(db, { categoryId: shirts, brandId: bc, referenceRetailMinor: 60000, allowedBps: 3000, retailSource: "test" });
    expect(pricingByExt(db, "FX-103")!.ruleLevel).toBe("brand_category");
    expect(pricingByExt(db, "FX-103")!.status).toBe("eligible"); // $153 ≤ $180

    // Product override beats both.
    setPriceOverride(db, "fixture", "FX-103", { referenceRetailMinor: 20000, allowedBps: 5000, retailSource: "tag" });
    expect(pricingByExt(db, "FX-103")!.ruleLevel).toBe("override");
    expect(pricingByExt(db, "FX-103")!.status).toBe("over_ceiling");

    // Preference change re-evaluates matches from stored data.
    expect(evalByExt(db, "FX-304")!.state).toBe("review");
    updateCategory(db, categoryId(db, "jackets-outerwear"), { acceptedSizes: ["44R", "XL"], reviewSizes: [] });
    expect(evalByExt(db, "FX-304")!.state).toBe("match");

    expect(provider.callCount).toBe(callsAfterScan); // nothing was fetched again
  });
});

describe("errors, rate limits, empty results and interrupted scans", () => {
  it("API authorization errors fail the scan with a clear message and no data", async () => {
    const { db } = memoryDb();
    const r = await scan(db, fixture(1, { failWith: "auth" }));
    expect(r.status).toBe("failed");
    expect(r.errors[0].code).toBe("auth");
    expect(r.errors).toHaveLength(1); // stopped immediately instead of hammering the API
    expect(db.select().from(s.listings).all()).toHaveLength(0);
  });

  it("access denied (keyset not enabled) is reported distinctly", async () => {
    const { db } = memoryDb();
    const r = await scan(db, fixture(1, { failWith: "access_denied" }));
    expect(r.status).toBe("failed");
    expect(r.errors[0].code).toBe("access_denied");
  });

  it("rate limits stop the scan, keep partial results and mark the run partial", async () => {
    const { db } = memoryDb();
    const r = await scan(db, fixture(1, { failWith: "rate_limited_after", rateLimitAfterCalls: 25 }));
    expect(r.status).toBe("partial");
    expect(r.rateLimited).toBe(true);
    expect(r.errors.at(-1)!.code).toBe("rate_limited");
    expect(db.select().from(s.listings).all().length).toBeGreaterThan(0);
    const run = db.select().from(s.scanRuns).where(eq(s.scanRuns.id, r.runId)).get()!;
    expect(run.rateLimited).toBe(true);
  });

  it("temporary errors are recorded per query and the scan continues", async () => {
    const { db } = memoryDb();
    const r = await scan(db, fixture(1, { failWith: "transient_once" }));
    expect(r.status).toBe("completed_with_errors");
    expect(r.errors).toHaveLength(1);
    expect(r.queriesCompleted).toBe(r.queriesPlanned - 1);
  });

  it("empty results complete cleanly", async () => {
    const { db } = memoryDb();
    const r = await scan(db, fixture(1, { items: [] }));
    expect(r.status).toBe("completed");
    expect(r.examined).toBe(0);
    expect(r.newListings).toBe(0);
    expect(r.errors).toEqual([]);
  });

  it("stale running scans are marked interrupted; a live running scan blocks a second one", async () => {
    const { db } = memoryDb();
    const old = new Date(Date.now() - 10 * 60_000);
    db.insert(s.scanRuns).values({ startedAt: old, heartbeatAt: old, status: "running", mode: "fixture", provider: "fixture" }).run();
    expect(recoverInterruptedScans(db)).toBe(1);
    expect(getRunningScan(db)).toBeNull();
    expect(db.select().from(s.scanRuns).all()[0].status).toBe("interrupted");

    const fresh = new Date();
    db.insert(s.scanRuns).values({ startedAt: fresh, heartbeatAt: fresh, status: "running", mode: "fixture", provider: "fixture" }).run();
    await expect(scan(db, fixture(1))).rejects.toBeInstanceOf(ScanInProgressError);
  });

  it("respects the daily call budget for live providers", async () => {
    const { db } = memoryDb();
    updateScanSettings(db, { dailyCallBudget: 3 });
    const inner = fixture(1);
    const live: ListingProvider = {
      id: "ebay",
      mode: "live",
      describe: () => ({ ...inner.describe(), id: "ebay", mode: "live" }),
      search: (q, p) => inner.search(q, p),
      getItem: (id) => inner.getItem(id),
      checkConnection: () => inner.checkConnection(),
    };
    const r = await scan(db, live);
    expect(r.apiCalls + r.detailCalls).toBeLessThanOrEqual(3);
    expect(r.status).toBe("partial");
    expect(r.errors.some((e) => e.code === "budget")).toBe(true);
  });

  it("refreshes stale saved listings that searches no longer return, and deletes them if ended", async () => {
    const { db } = memoryDb();
    await scan(db, fixture(1));
    setUserState(db, "fixture", "FX-102", { saved: true });
    setUserState(db, "fixture", "FX-104", { saved: true });
    const old = new Date(Date.now() - 8 * 3_600_000);
    db.update(s.listings).set({ lastSeenAt: old }).where(eq(s.listings.source, "fixture")).run();
    class DetailsOnly extends FixtureProvider {
      async search() {
        return { items: [], total: 0, hasMore: false, nextOffset: null, warnings: [] };
      }
      async getItem(externalId: string): Promise<ItemDetailResult> {
        if (externalId === "FX-104") return { externalId, listing: null, ended: true };
        return super.getItem(externalId);
      }
    }
    const r = await scan(db, new DetailsOnly({ batch: 1, now: NOW }));
    expect(r.refreshedSaved).toBe(1);
    expect(listingByExt(db, "FX-102")!.lastSeenAt.getTime()).toBeGreaterThan(old.getTime());
    expect(listingByExt(db, "FX-104")).toBeUndefined(); // ended → content deleted
    expect(getUserState(db, "fixture", "FX-104")!.saved).toBe(true); // decision kept
  });

  it("deletes listings that the source reports as ended", async () => {
    const { db } = memoryDb();
    class EndingProvider extends FixtureProvider {
      async getItem(externalId: string): Promise<ItemDetailResult> {
        if (externalId === "FX-111") return { externalId, listing: null, ended: true };
        return super.getItem(externalId);
      }
    }
    await scan(db, new EndingProvider({ batch: 1, now: NOW }));
    expect(listingByExt(db, "FX-111")).toBeUndefined();
    expect(listingByExt(db, "FX-101")).toBeDefined();
  });
});
