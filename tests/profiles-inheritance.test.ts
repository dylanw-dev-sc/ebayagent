import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { resolveProfile, type PersonalDefaults } from "../src/lib/profiles/resolve";
import type { BrandConfig, CategoryConfig } from "../src/lib/domain/types";
import * as s from "../src/server/db/schema";
import { getProfile, duplicateProfile, resetProfileOverride, setProfileOverride, setProfileSizeOverride, updateProfileMeta, deleteProfile } from "../src/server/services/profiles";
import { updateCategory, updateCondition, updateDefaults } from "../src/server/services/preferences";
import { categoryId, memoryDb, profileId } from "./helpers";

const brands: BrandConfig[] = [
  { id: 1, name: "A", enabled: true, aliases: [], excludePhrases: [], groupIds: [10] },
  { id: 2, name: "B", enabled: true, aliases: [], excludePhrases: [], groupIds: [20] },
  { id: 3, name: "C", enabled: false, aliases: [], excludePhrases: [], groupIds: [10] },
];
const categories: CategoryConfig[] = [
  { id: 7, slug: "shirts", name: "Shirts", noun: "shirt", enabled: true, sizeSystem: "alpha", defaultSizes: { accepted: ["L"], review: [], neck: [], sleeve: [] }, ebayCategoryIds: [], titleKeywords: [], excludeKeywords: [] },
  { id: 8, slug: "jackets", name: "Jackets", noun: "jacket", enabled: true, sizeSystem: "tailored", defaultSizes: { accepted: ["44R"], review: [], neck: [], sleeve: [] }, ebayCategoryIds: [], titleKeywords: [], excludeKeywords: [] },
];
const defaults: PersonalDefaults = { conditionKeys: ["new"], excludedMaterialKeys: [], unknownMaterialPolicy: "review", excludeKeywords: [], priceMinMinor: null, priceMaxMinor: null };

describe("inheritance resolver (pure)", () => {
  it("a profile with no overrides inherits everything", () => {
    const r = resolveProfile({ overrides: {}, defaults, brands, categories });
    expect(r.settings.brandIds).toEqual([1, 2]); // disabled brand C excluded
    expect(r.settings.categoryIds).toEqual([7, 8]);
    expect(r.settings.sizes[8].accepted).toEqual(["44R"]);
    expect(Object.values(r.provenance).every((p) => p === "inherited")).toBe(true);
  });

  it("overrides apply per field and are reported as overrides", () => {
    const r = resolveProfile({
      overrides: { brandScope: { groupIds: [10], brandIds: [] }, sizes: { "8": { accepted: ["42R"], review: [], neck: [], sleeve: [] } }, unknownMaterialPolicy: "allow" },
      defaults,
      brands,
      categories,
    });
    expect(r.settings.brandIds).toEqual([1]);
    expect(r.settings.sizes[8].accepted).toEqual(["42R"]);
    expect(r.settings.sizes[7].accepted).toEqual(["L"]); // other category still inherits
    expect(r.provenance.brandScope).toBe("override");
    expect(r.provenance.categoryIds).toBe("inherited");
    expect(r.provenance.unknownMaterialPolicy).toBe("override");
    expect(r.sizeProvenance[8]).toBe("override");
    expect(r.sizeProvenance[7]).toBe("inherited");
  });

  it("an explicit empty override is still an override (not inheritance)", () => {
    const r = resolveProfile({ overrides: { excludeKeywords: [] }, defaults: { ...defaults, excludeKeywords: ["kids"] }, brands, categories });
    expect(r.settings.excludeKeywords).toEqual([]);
    expect(r.provenance.excludeKeywords).toBe("override");
  });
});

describe("inheritance with stored preferences", () => {
  it("changing a default updates inheriting profiles but never overwrites explicit overrides", () => {
    const { db } = memoryDb();
    const jackets = categoryId(db, "jackets-outerwear");
    const inheriting = profileId(db, "Heritage Jackets");
    const overriding = profileId(db, "All Preferences");
    setProfileSizeOverride(db, overriding, jackets, { accepted: ["46R"], review: [], neck: [], sleeve: [] });

    updateCategory(db, jackets, { acceptedSizes: ["44R", "44L"] });

    expect(getProfile(db, inheriting)!.resolved.settings.sizes[jackets].accepted).toEqual(["44R", "44L"]);
    expect(getProfile(db, inheriting)!.resolved.sizeProvenance[jackets]).toBe("inherited");
    expect(getProfile(db, overriding)!.resolved.settings.sizes[jackets].accepted).toEqual(["46R"]);
    expect(getProfile(db, overriding)!.resolved.sizeProvenance[jackets]).toBe("override");
  });

  it("default conditions flow to profiles until overridden; reset restores inheritance", () => {
    const { db } = memoryDb();
    const pid = profileId(db, "Luxury Shirts");
    const fair = db.select().from(s.conditions).where(eq(s.conditions.key, "preowned_fair")).get()!;
    updateCondition(db, fair.id, { accepted: false });
    expect(getProfile(db, pid)!.resolved.settings.conditionKeys).not.toContain("preowned_fair");

    setProfileOverride(db, pid, "conditionKeys", ["new_with_tags"]);
    updateCondition(db, fair.id, { accepted: true });
    expect(getProfile(db, pid)!.resolved.settings.conditionKeys).toEqual(["new_with_tags"]);

    resetProfileOverride(db, pid, "conditionKeys");
    expect(getProfile(db, pid)!.resolved.settings.conditionKeys).toContain("preowned_fair");
    expect(getProfile(db, pid)!.resolved.provenance.conditionKeys).toBe("inherited");
  });

  it("default policy changes flow through; duplicates copy overrides; profiles can be disabled and deleted", () => {
    const { db } = memoryDb();
    const pid = profileId(db, "Premium Button-Downs");
    updateDefaults(db, { unknownMaterialPolicy: "allow" });
    expect(getProfile(db, pid)!.resolved.settings.unknownMaterialPolicy).toBe("allow");

    const copy = duplicateProfile(db, pid);
    const dup = getProfile(db, copy)!;
    expect(dup.name).toBe("Premium Button-Downs (copy)");
    expect(dup.enabled).toBe(false);
    expect(dup.overrides).toEqual(getProfile(db, pid)!.overrides);

    updateProfileMeta(db, pid, { enabled: false });
    expect(getProfile(db, pid)!.enabled).toBe(false);
    deleteProfile(db, copy);
    expect(getProfile(db, copy)).toBeNull();
  });
});
