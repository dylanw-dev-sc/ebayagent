import { describe, expect, it } from "vitest";
import { evaluateListing, type ListingForEvaluation } from "../src/lib/matching/engine";
import type { AppDb } from "../src/server/db/client";
import { loadBrands, loadCategories } from "../src/server/services/context";
import {
  addBrandAlias,
  addBrandExcludePhrase,
  addCategoryExcludeKeyword,
  addCategorySize,
  removeCategorySize,
  suggestCorrections,
  type Suggestion,
} from "../src/server/services/corrections";
import { brandId, categoryId, ctxFor, EBAY_CAT, listing, memoryDb } from "./helpers";

function suggest(db: AppDb, l: ListingForEvaluation): Suggestion[] {
  const ev = evaluateListing(l, ctxFor(db));
  return suggestCorrections({
    title: l.title,
    brandAspect: l.brandAspect,
    facts: ev.facts,
    bestProfile: ev.profiles.find((p) => p.state === ev.state),
    brands: loadBrands(db),
    categories: loadCategories(db).map((c) => ({ id: c.id, name: c.name, acceptedSizes: c.defaultSizes.accepted, reviewSizes: c.defaultSizes.review, excludeKeywords: c.excludeKeywords })),
  });
}
const state = (db: AppDb, l: ListingForEvaluation) => evaluateListing(l, ctxFor(db)).state;

describe("one-click corrections", () => {
  it("misspelled brand → suggests an alias for the closest brand; applying it makes the listing match", () => {
    const { db } = memoryDb();
    const l = listing({ title: "Brunello Cuccinelli cashmere polo", brandAspect: "Brunello Cuccinelli", sizeAspect: "L", materialAspect: "100% Cashmere", ebayCategoryIds: [EBAY_CAT.polo] });
    expect(state(db, l)).toBe("no_match");
    const sg = suggest(db, l).find((x) => x.kind === "brand_alias")!;
    expect(sg).toEqual({ kind: "brand_alias", alias: "Brunello Cuccinelli", brandId: brandId(db, "Brunello Cucinelli") });
    addBrandAlias(db, sg.brandId!, sg.alias);
    expect(state(db, l)).toBe("match");
  });

  it("wrong brand (fabric mill / other label) → suggests a never-match phrase", () => {
    const { db } = memoryDb();
    const l = listing({ title: "Suitsupply Lazio Blazer in Loro Piana Wool 44R", brandAspect: "Suitsupply", sizeAspect: "44R", materialAspect: "100% Wool", ebayCategoryIds: [EBAY_CAT.tailored] });
    expect(state(db, l)).toBe("review");
    const sg = suggest(db, l).find((x) => x.kind === "brand_exclude")!;
    expect(sg).toMatchObject({ brandName: "Loro Piana", phrase: "Suitsupply" });
    if (sg.kind !== "brand_exclude") throw new Error("unexpected");
    addBrandExcludePhrase(db, sg.brandId, sg.phrase);
    expect(state(db, l)).toBe("no_match");
  });

  it("size you'd accept → suggests accepting it (and sending it to review when excluded)", () => {
    const { db } = memoryDb();
    const l = listing({ title: "Isaia sport coat", brandAspect: "Isaia", sizeAspect: "42R", materialAspect: "100% Wool", ebayCategoryIds: [EBAY_CAT.tailored] });
    const kinds = suggest(db, l).filter((x) => x.kind === "size_accept");
    expect(kinds.map((x) => (x.kind === "size_accept" ? x.list : ""))).toEqual(["accepted", "review"]);
    addCategorySize(db, categoryId(db, "jackets-outerwear"), "42R", "accepted");
    expect(state(db, l)).toBe("match");
  });

  it("accepted size that doesn't fit → suggests removing it", () => {
    const { db } = memoryDb();
    const l = listing({ title: "Kiton jacket", brandAspect: "Kiton", sizeAspect: "44R", materialAspect: "100% Cashmere", ebayCategoryIds: [EBAY_CAT.tailored] });
    const sg = suggest(db, l).find((x) => x.kind === "size_remove")!;
    expect(sg).toMatchObject({ size: "44R" });
    addCategorySize(db, categoryId(db, "jackets-outerwear"), "42R", "accepted");
    removeCategorySize(db, categoryId(db, "jackets-outerwear"), "44 Regular"); // same size, other spelling
    expect(state(db, l)).toBe("no_match");
    // With no accepted sizes left at all, the engine can't judge size and asks for review instead.
    removeCategorySize(db, categoryId(db, "jackets-outerwear"), "42R");
    expect(state(db, l)).toBe("review");
  });

  it("different garment in a category → suggests an exclude keyword", () => {
    const { db } = memoryDb();
    const l = listing({ title: "Kiton silk scarf navy", brandAspect: "Kiton", materialAspect: "100% Silk", ebayCategoryIds: [EBAY_CAT.jacket] });
    const sg = suggest(db, l).find((x) => x.kind === "category_exclude")!;
    expect(sg).toMatchObject({ keyword: "scarf", categoryName: "Jackets & Outerwear" });
    if (sg.kind !== "category_exclude") throw new Error("unexpected");
    addCategoryExcludeKeyword(db, sg.categoryId, sg.keyword);
    expect(evaluateListing(l, ctxFor(db)).summary).toMatch(/scarf/);
    expect(state(db, l)).toBe("no_match");
  });
});
