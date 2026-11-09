import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FixtureProvider } from "../src/lib/providers/fixture/provider";
import { openDatabase } from "../src/server/db/client";
import * as s from "../src/server/db/schema";
import { seedDatabase } from "../src/server/db/seed";
import { runScan } from "../src/server/scanner/run";
import { createPricingRule } from "../src/server/services/pricing";
import { deleteBrand, updateBrand } from "../src/server/services/preferences";
import { getProfile, setProfileOverride } from "../src/server/services/profiles";
import { getUserState, setUserState } from "../src/server/services/user-state";
import { brandId, categoryId, profileId, tempDbPath } from "./helpers";

const counts = (db: ReturnType<typeof openDatabase>["db"]) => ({
  brands: db.select().from(s.brands).all().length,
  aliases: db.select().from(s.brandAliases).all().length,
  groups: db.select().from(s.brandGroups).all().length,
  categories: db.select().from(s.categories).all().length,
  materials: db.select().from(s.materials).all().length,
  conditions: db.select().from(s.conditions).all().length,
  profiles: db.select().from(s.searchProfiles).all().length,
});

describe("restart persistence and idempotent seeding", () => {
  it("keeps user edits across restarts and never re-seeds over them", async () => {
    const file = tempDbPath();

    // --- first run: edit preferences, scan, save state
    let h = openDatabase(file);
    const initial = counts(h.db);
    expect(initial.brands).toBe(36);
    updateBrand(h.db, brandId(h.db, "Kiton"), { enabled: false, aliases: ["Kiton Napoli"] });
    deleteBrand(h.db, brandId(h.db, "Eton"));
    const pid = profileId(h.db, "Luxury Shirts");
    setProfileOverride(h.db, pid, "unknownMaterialPolicy", "allow");
    createPricingRule(h.db, { categoryId: categoryId(h.db, "shirts"), brandId: null, referenceRetailMinor: 20000, allowedBps: 4000, retailSource: "my notes" });
    await runScan(h.db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test" });
    setUserState(h.db, "fixture", "FX-102", { saved: true });
    setUserState(h.db, "fixture", "FX-101", { dismissed: true, reviewed: true });
    const listingsBefore = h.db.select().from(s.listings).all().length;
    h.sqlite.close();

    // --- restart
    h = openDatabase(file);
    const kiton = h.db.select().from(s.brands).where(eq(s.brands.name, "Kiton")).get()!;
    expect(kiton.enabled).toBe(false);
    expect(h.db.select().from(s.brandAliases).where(eq(s.brandAliases.brandId, kiton.id)).all().map((a) => a.alias)).toEqual(["Kiton Napoli"]);
    expect(h.db.select().from(s.brands).where(eq(s.brands.name, "Eton")).get()).toBeUndefined(); // deletion respected
    expect(counts(h.db).brands).toBe(35);
    expect(getProfile(h.db, pid)!.overrides.unknownMaterialPolicy).toBe("allow");
    expect(h.db.select().from(s.pricingRules).all()).toHaveLength(1);
    expect(h.db.select().from(s.listings).all().length).toBe(listingsBefore);
    expect(h.db.select().from(s.scanRuns).all()).toHaveLength(1);
    expect(getUserState(h.db, "fixture", "FX-102")!.saved).toBe(true);
    expect(getUserState(h.db, "fixture", "FX-101")).toMatchObject({ dismissed: true, reviewed: true });

    // --- even a forced re-seed creates no duplicates and doesn't overwrite edits
    seedDatabase(h.db, { force: true });
    const after = counts(h.db);
    expect(after.groups).toBe(initial.groups);
    expect(after.categories).toBe(initial.categories);
    expect(after.materials).toBe(initial.materials);
    expect(after.conditions).toBe(initial.conditions);
    expect(after.profiles).toBe(initial.profiles);
    expect(h.db.select().from(s.brands).where(eq(s.brands.name, "Kiton")).get()!.enabled).toBe(false);
    h.sqlite.close();
  });
});
