import { eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FixtureProvider } from "../src/lib/providers/fixture/provider";
import { openDatabase, type AppDb } from "../src/server/db/client";
import * as s from "../src/server/db/schema";
import { applySeedUpgrades } from "../src/server/db/seed";
import { runScan } from "../src/server/scanner/run";
import { memoryDb, tempDbPath } from "./helpers";

const scan = (db: AppDb) => runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test" });

function evalOf(db: AppDb, externalId: string) {
  return db
    .select({ state: s.listingEvaluations.state, summary: s.listingEvaluations.summary })
    .from(s.listingEvaluations)
    .innerJoin(s.listings, eq(s.listings.id, s.listingEvaluations.listingId))
    .where(eq(s.listings.externalId, externalId))
    .get();
}

const acceptedConditions = (db: AppDb) =>
  db
    .select()
    .from(s.conditions)
    .all()
    .filter((c) => c.accepted)
    .map((c) => c.key)
    .sort();

/** Make a freshly seeded database look like one seeded before these changes existed. */
function makeOld(db: AppDb) {
  db.delete(s.categories).where(eq(s.categories.slug, "knitwear")).run();
  db.update(s.conditions).set({ accepted: true }).run();
  db.delete(s.meta).where(like(s.meta.key, "upgrade_%")).run();
}

describe("Sweaters & Knitwear", () => {
  it("is seeded with eBay's Sweaters category and your L/XL sizes", () => {
    const { db } = memoryDb();
    const knit = db.select().from(s.categories).where(eq(s.categories.slug, "knitwear")).get();
    expect(knit).toMatchObject({ name: "Sweaters & Knitwear", ebayCategoryIds: ["11484"], acceptedSizes: ["L", "XL"], enabled: true });
  });

  it("finds sweaters and judges them like your other categories", async () => {
    const { db } = memoryDb();
    expect((await scan(db)).status).toBe("completed");
    expect(evalOf(db, "FX-601")?.state).toBe("match"); // merino crewneck, L
    expect(evalOf(db, "FX-602")?.state).toBe("match"); // cashmere cardigan, XL
    expect(evalOf(db, "FX-605")?.state).toBe("match"); // "Lambswool" counts as wool; British "jumper"
    expect(evalOf(db, "FX-603")).toMatchObject({ state: "review" }); // Italian size 52
    expect(evalOf(db, "FX-603")!.summary).toMatch(/numeric size 52/);
    expect(evalOf(db, "FX-604")!.summary).toMatch(/sweater is size M/);
  });
});

describe("accepted conditions", () => {
  it("New with defects and Pre-owned – Fair aren't accepted, so scans don't ask eBay for them", async () => {
    const { db } = memoryDb();
    expect(acceptedConditions(db)).toEqual(["new_with_tags", "new_without_tags", "preowned_excellent", "preowned_good"]);
    await scan(db);
    expect(evalOf(db, "FX-315")).toBeUndefined(); // New with defects
    expect(evalOf(db, "FX-319")).toBeUndefined(); // Pre-owned – Fair
  });
});

describe("one-time upgrades for databases seeded by an earlier version", () => {
  it("adds the knitwear category and drops Fair/defects once, then leaves your later edits alone", () => {
    const { db } = memoryDb();
    expect(applySeedUpgrades(db).changed).toBe(false); // a new database already has them
    makeOld(db);
    expect(applySeedUpgrades(db).changed).toBe(true);
    expect(db.select().from(s.categories).where(eq(s.categories.slug, "knitwear")).get()).toBeDefined();
    expect(acceptedConditions(db)).not.toContain("preowned_fair");
    expect(acceptedConditions(db)).not.toContain("new_with_defects");

    // You delete the category and accept Fair again: the upgrades don't undo that.
    db.delete(s.categories).where(eq(s.categories.slug, "knitwear")).run();
    db.update(s.conditions).set({ accepted: true }).where(eq(s.conditions.key, "preowned_fair")).run();
    expect(applySeedUpgrades(db).changed).toBe(false);
    expect(db.select().from(s.categories).where(eq(s.categories.slug, "knitwear")).get()).toBeUndefined();
    expect(acceptedConditions(db)).toContain("preowned_fair");
  });

  it("doesn't add a second sweater category if you already made one", () => {
    const { db } = memoryDb();
    makeOld(db);
    db.insert(s.categories)
      .values({
        slug: "my-sweaters",
        name: "My Sweaters",
        noun: "sweater",
        description: "",
        sizeSystem: "alpha",
        acceptedSizes: ["L"],
        reviewSizes: [],
        neckSizes: [],
        sleeveLengths: [],
        ebayCategoryIds: ["11484"],
        titleKeywords: [],
        excludeKeywords: [],
        sortOrder: 9,
      })
      .run();
    applySeedUpgrades(db);
    const mapped = db.select().from(s.categories).all().filter((c) => c.ebayCategoryIds.includes("11484"));
    expect(mapped.map((c) => c.slug)).toEqual(["my-sweaters"]);
  });

  it("re-checks stored listings when an upgrade changes your settings", async () => {
    const file = tempDbPath();
    let h = openDatabase(file);
    makeOld(h.db);
    await scan(h.db);
    expect(evalOf(h.db, "FX-319")?.state).toBe("review"); // Fair was still accepted; "Size 54" needs review
    h.sqlite.close();

    h = openDatabase(file); // the app restarts on the new version
    expect(evalOf(h.db, "FX-319")).toMatchObject({ state: "no_match" });
    expect(evalOf(h.db, "FX-319")!.summary).toMatch(/Pre-owned – Fair/);
    h.sqlite.close();
  });
});
