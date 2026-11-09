import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FixtureProvider } from "../src/lib/providers/fixture/provider";
import * as s from "../src/server/db/schema";
import { runScan } from "../src/server/scanner/run";
import { getFeed, getFeedNeighbors, type FeedFilters } from "../src/server/services/feed";
import { newSinceFor, recordVisit, SESSION_GAP_MS } from "../src/server/services/visits";
import { memoryDb } from "./helpers";

const base: FeedFilters = { view: "all", sort: "newest", page: 1, pageSize: 500 };

describe("new since your last visit", () => {
  it("uses browsing sessions so badges don't vanish while you look", () => {
    const { db } = memoryDb();
    const t0 = Date.now() - 10 * 3_600_000;
    expect(newSinceFor(db, "fixture", t0)).toBeNull(); // very first visit: no badges
    recordVisit(db, "fixture", t0);
    expect(newSinceFor(db, "fixture", t0 + 10 * 60_000)).toBeNull(); // same session

    const t1 = t0 + 2 * 3_600_000; // came back later: a new session
    expect(newSinceFor(db, "fixture", t1)?.getTime()).toBe(t0);
    recordVisit(db, "fixture", t1);
    expect(newSinceFor(db, "fixture", t1 + 5 * 60_000)?.getTime()).toBe(t0); // stable within the session
    recordVisit(db, "fixture", t1 + 5 * 60_000);
    expect(newSinceFor(db, "fixture", t1 + 5 * 60_000 + SESSION_GAP_MS + 1)?.getTime()).toBe(t1 + 5 * 60_000);
  });

  it("flags and filters listings first seen after the last visit", async () => {
    const { db } = memoryDb();
    await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test" });
    const cutoff = new Date(Date.now() - 3_600_000);
    db.update(s.listings).set({ firstSeenAt: new Date(Date.now() - 5 * 3_600_000) }).run();
    db.update(s.listings).set({ firstSeenAt: new Date() }).where(eq(s.listings.externalId, "FX-101")).run();
    const feed = getFeed(db, { ...base, newSince: cutoff }, "fixture");
    expect(feed.items.filter((i) => i.isNew).map((i) => i.externalId)).toEqual(["FX-101"]);
    expect(feed.newCount).toBe(1);
    const onlyNew = getFeed(db, { ...base, newSince: cutoff, newOnly: true }, "fixture");
    expect(onlyNew.items.map((i) => i.externalId)).toEqual(["FX-101"]);
    expect(getFeed(db, { ...base, newSince: null }, "fixture").items.some((i) => i.isNew)).toBe(false);
  });
});

describe("previous / next in the detail view", () => {
  it("steps through the feed order across pages", async () => {
    const { db } = memoryDb();
    await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test" });
    const f: FeedFilters = { ...base, pageSize: 5 };
    const all = getFeed(db, { ...base }, "fixture").items.map((i) => i.id);
    expect(all.length).toBeGreaterThan(10);

    const first = getFeedNeighbors(db, f, "fixture", all[0]);
    expect(first).toMatchObject({ index: 0, total: all.length, prev: null, next: { id: all[1], page: 1 } });

    const fifth = getFeedNeighbors(db, f, "fixture", all[4]);
    expect(fifth.next).toEqual({ id: all[5], page: 2 }); // crosses into page 2

    const last = getFeedNeighbors(db, f, "fixture", all[all.length - 1]);
    expect(last.next).toBeNull();
    expect(last.prev?.id).toBe(all[all.length - 2]);

    expect(getFeedNeighbors(db, { ...f, view: "dismissed" }, "fixture", all[0]).index).toBeNull(); // not in this view
  });
});
