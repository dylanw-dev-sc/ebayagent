import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { evaluateListing } from "../src/lib/matching/engine";
import * as s from "../src/server/db/schema";
import { setProfileOverride } from "../src/server/services/profiles";
import { updateBrand, updateCondition, updateDefaults } from "../src/server/services/preferences";
import { brandId, categoryId, ctxFor, EBAY_CAT, listing, memoryDb, profileId } from "./helpers";

describe("matching engine: states and explanations", () => {
  const { db } = memoryDb();
  const ctx = ctxFor(db);

  it("confirmed match with a readable explanation", () => {
    const ev = evaluateListing(
      listing({ title: "Brunello Cucinelli slim fit button down shirt L", brandAspect: "Brunello Cucinelli", sizeAspect: "L", materialAspect: "100% Cotton", ebayCategoryIds: [EBAY_CAT.casual] }),
      ctx,
    );
    expect(ev.state).toBe("match");
    expect(ev.summary).toMatch(/^Matches your preferred brand \(Brunello Cucinelli\) and Large button-down shirt size\./);
  });

  it("missing fabric composition → needs review (not excluded, not matched)", () => {
    const ev = evaluateListing(
      listing({ title: "Brunello Cucinelli crew neck tee grey", brandAspect: "Brunello Cucinelli", sizeAspect: "L", ebayCategoryIds: [EBAY_CAT.tee] }),
      ctx,
    );
    expect(ev.state).toBe("review");
    expect(ev.summary).toBe("Needs review: seller did not provide fabric composition.");
  });

  it("wrong jacket size → excluded with the exact reason", () => {
    const ev = evaluateListing(
      listing({ title: "Boglioli K jacket unstructured blazer 40R", brandAspect: "Boglioli", sizeAspect: "40R", materialAspect: "100% Wool", ebayCategoryIds: [EBAY_CAT.tailored] }),
      ctx,
    );
    expect(ev.state).toBe("no_match");
    expect(ev.summary).toBe("Excluded: jacket is size 40R, your accepted size is 44R.");
  });

  it("44R jacket by a heritage brand matches", () => {
    const ev = evaluateListing(
      listing({ title: "Private White V.C. Harrington jacket", brandAspect: "Private White V.C.", sizeAspect: "44 Regular", materialAspect: "100% Cotton", ebayCategoryIds: [EBAY_CAT.jacket] }),
      ctx,
    );
    expect(ev.state).toBe("match");
  });

  it("non-preferred brand is excluded", () => {
    const ev = evaluateListing(listing({ title: "Polo Ralph Lauren oxford shirt", brandAspect: "Polo Ralph Lauren", sizeAspect: "L", materialAspect: "Cotton", ebayCategoryIds: [EBAY_CAT.casual] }), ctx);
    expect(ev.state).toBe("no_match");
    expect(ev.summary).toMatch(/Polo Ralph Lauren/);
  });

  it("category exclude keywords keep trousers out of Jackets", () => {
    const ev = evaluateListing(listing({ title: "Incotex wool trousers size 34", brandAspect: "Incotex", sizeAspect: "34", materialAspect: "Wool", ebayCategoryIds: [EBAY_CAT.tailored] }), ctx);
    expect(ev.state).toBe("no_match");
    expect(ev.summary).toMatch(/trousers/);
  });

  it("unknown category goes to review", () => {
    const ev = evaluateListing(listing({ title: "Kiton accessory item", brandAspect: "Kiton" }), ctx);
    expect(ev.state).toBe("review");
  });
});

describe("multiple matching search profiles", () => {
  const { db } = memoryDb();
  const ctx = ctxFor(db);

  it("records every matching profile on a single listing", () => {
    const ev = evaluateListing(
      listing({ title: "Brunello Cucinelli button down shirt L", brandAspect: "Brunello Cucinelli", sizeAspect: "L", materialAspect: "Cotton", ebayCategoryIds: [EBAY_CAT.casual] }),
      ctx,
    );
    const names = ev.profiles.filter((p) => p.state === "match").map((p) => p.profileName).sort();
    expect(names).toEqual(["All Preferences", "Luxury Shirts", "Premium Button-Downs"]);
    expect(ev.matchedProfileIds).toContain(profileId(db, "Luxury Shirts"));
    // Heritage Jackets doesn't include shirts or Group 1
    expect(ev.profiles.find((p) => p.profileName === "Heritage Jackets")?.state).toBe("no_match");
  });

  it("profile scope limits brands and categories", () => {
    const ev = evaluateListing(
      listing({ title: "Sunspel crew neck tee L", brandAspect: "Sunspel", sizeAspect: "L", materialAspect: "100% Cotton", ebayCategoryIds: [EBAY_CAT.tee] }),
      ctx,
    );
    expect(ev.profiles.find((p) => p.profileName === "All Preferences")?.state).toBe("match");
    expect(ev.profiles.find((p) => p.profileName === "Luxury Shirts")?.summary).toMatch(/isn't one of this profile's brands/);
  });
});

describe("preference changes alter decisions (no hardcoded preferences)", () => {
  it("disabling a brand excludes it everywhere", () => {
    const { db } = memoryDb();
    updateBrand(db, brandId(db, "Sunspel"), { enabled: false });
    const ev = evaluateListing(listing({ title: "Sunspel tee L", brandAspect: "Sunspel", sizeAspect: "L", materialAspect: "Cotton", ebayCategoryIds: [EBAY_CAT.tee] }), ctxFor(db));
    expect(ev.state).toBe("no_match");
    expect(ev.summary).toMatch(/disabled/);
  });

  it("rejecting a condition excludes listings in that condition", () => {
    const { db } = memoryDb();
    const fair = db.select().from(s.conditions).where(eq(s.conditions.key, "preowned_fair")).get()!;
    updateCondition(db, fair.id, { accepted: false });
    const ev = evaluateListing(
      listing({ title: "Barena overshirt jacket 44R", brandAspect: "Barena", sizeAspect: "44R", materialAspect: "Wool", conditionId: "3010", conditionText: "Pre-owned - Fair", ebayCategoryIds: [EBAY_CAT.jacket] }),
      ctxFor(db),
    );
    expect(ev.state).toBe("no_match");
    expect(ev.summary).toMatch(/Pre-owned – Fair/);
  });

  it("'allow unknown fabric' turns fabric-only review into a match", () => {
    const { db } = memoryDb();
    updateDefaults(db, { unknownMaterialPolicy: "allow" });
    const ev = evaluateListing(listing({ title: "Norse Projects tee", brandAspect: "Norse Projects", sizeAspect: "L", ebayCategoryIds: [EBAY_CAT.tee] }), ctxFor(db));
    expect(ev.state).toBe("match");
  });

  it("required materials: unknown → review, absent → excluded, present → match", () => {
    const { db } = memoryDb();
    const pid = profileId(db, "All Preferences");
    setProfileOverride(db, pid, "requiredMaterialKeys", ["cashmere"]);
    const ctx = ctxFor(db);
    const base = { brandAspect: "Kiton", sizeAspect: "44R", ebayCategoryIds: [EBAY_CAT.tailored] };
    const all = (t: string, m: string | null) => evaluateListing(listing({ title: t, materialAspect: m, ...base }), ctx).profiles.find((p) => p.profileId === pid)!;
    expect(all("Kiton sport coat", null).state).toBe("review");
    expect(all("Kiton sport coat", "100% Linen").state).toBe("no_match");
    expect(all("Kiton sport coat", "100% Cashmere").state).toBe("match");
  });

  it("excluded keywords exclude listings", () => {
    const { db } = memoryDb();
    updateDefaults(db, { excludeKeywords: ["kids"] });
    const ev = evaluateListing(listing({ title: "Sunspel kids tee L", brandAspect: "Sunspel", sizeAspect: "L", materialAspect: "Cotton", ebayCategoryIds: [EBAY_CAT.tee] }), ctxFor(db));
    expect(ev.state).toBe("no_match");
  });

  it("category-specific size changes apply without code changes", () => {
    const { db } = memoryDb();
    const before = evaluateListing(listing({ title: "Isaia sport coat", brandAspect: "Isaia", sizeAspect: "42R", materialAspect: "Wool", ebayCategoryIds: [EBAY_CAT.tailored] }), ctxFor(db));
    expect(before.state).toBe("no_match");
    db.update(s.categories).set({ acceptedSizes: ["42R", "44R"] }).where(eq(s.categories.id, categoryId(db, "jackets-outerwear"))).run();
    const after = evaluateListing(listing({ title: "Isaia sport coat", brandAspect: "Isaia", sizeAspect: "42R", materialAspect: "Wool", ebayCategoryIds: [EBAY_CAT.tailored] }), ctxFor(db));
    expect(after.state).toBe("match");
  });
});
