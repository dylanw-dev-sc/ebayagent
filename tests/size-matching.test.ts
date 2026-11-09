import { describe, expect, it } from "vitest";
import { evaluateSize, parseSizeFromTitle, parseSizeText, readListingSize, sizeKey } from "../src/lib/matching/size";
import type { SizePrefs } from "../src/lib/domain/types";

const shirts: SizePrefs = { accepted: ["L", "XL"], review: [], neck: [], sleeve: [] };
const jackets: SizePrefs = { accepted: ["44R"], review: ["XL"], neck: [], sleeve: [] };
const jacketsNoReview: SizePrefs = { accepted: ["44R"], review: [], neck: [], sleeve: [] };

const evalShirt = (sizeAspect: string | null, title = "Shirt") => evaluateSize(readListingSize({ sizeAspect, title }), shirts, "alpha", "shirt");
const evalJacket = (sizeAspect: string | null, title = "Jacket", prefs = jackets) =>
  evaluateSize(readListingSize({ sizeAspect, title }), prefs, "tailored", "jacket");

describe("size parsing", () => {
  it("recognizes letter-size equivalents", () => {
    expect(parseSizeText("Large").map(sizeKey)).toEqual(["L"]);
    expect(parseSizeText("L").map(sizeKey)).toEqual(["L"]);
    expect(parseSizeText("Extra Large").map(sizeKey)).toEqual(["XL"]);
    expect(parseSizeText("X-Large").map(sizeKey)).toEqual(["XL"]);
    expect(parseSizeText("XL").map(sizeKey)).toEqual(["XL"]);
    expect(parseSizeText("L/XL").map(sizeKey)).toEqual(["L", "XL"]);
    expect(parseSizeText("L Tall").map(sizeKey)).toEqual(["LT"]);
  });

  it("recognizes unambiguous 44R equivalents", () => {
    for (const s of ["44R", "44 R", "44 Regular", "44 Reg", "44Reg", "Size 44 Regular"]) {
      expect(parseSizeText(s).map(sizeKey)).toEqual(["44R"]);
    }
    expect(parseSizeText("44L").map(sizeKey)).toEqual(["44L"]);
    expect(parseSizeText("IT 54").map(sizeKey)).toEqual(["EU 54"]);
    expect(parseSizeText("16.5/35").map(sizeKey)).toEqual(["16.5/35"]);
    expect(parseSizeText("16 1/2 34/35").map(sizeKey)).toEqual(["16.5/34-35"]);
  });

  it("reads sizes from titles conservatively", () => {
    expect(parseSizeFromTitle("Sunspel crew neck tee navy size L").map(sizeKey)).toEqual(["L"]);
    expect(parseSizeFromTitle("Isaia sport coat 44R brown").map(sizeKey)).toEqual(["44R"]);
    expect(parseSizeFromTitle("Polo Ralph Lauren Large Pony polo shirt").map(sizeKey)).toEqual([]);
    expect(parseSizeFromTitle("Mid weight medium wash denim jacket").map(sizeKey)).toEqual([]);
  });
});

describe("category-specific size matching", () => {
  it("shirts accept Large or Extra Large", () => {
    expect(evalShirt("L").state).toBe("match");
    expect(evalShirt("Large").state).toBe("match");
    expect(evalShirt("XL").state).toBe("match");
    expect(evalShirt("M").state).toBe("no_match");
    expect(evalShirt("XXL").state).toBe("no_match");
  });

  it("44R jackets match only 44R / 44 Regular", () => {
    expect(evalJacket("44R").state).toBe("match");
    expect(evalJacket("44 Regular").state).toBe("match");
  });

  it("a 40R jacket is excluded with a clear reason", () => {
    const r = evalJacket("40R");
    expect(r.state).toBe("no_match");
    expect(r.message).toBe("jacket is size 40R, your accepted size is 44R");
  });

  it("44 Long is not 44R", () => {
    expect(evalJacket("44L").state).toBe("no_match");
  });

  it("does NOT assume an XL jacket is 44R", () => {
    const withReviewList = evalJacket("XL");
    expect(withReviewList.state).toBe("review");
    expect(withReviewList.message).toMatch(/size to review/);
    const without = evalJacket("XL", "Jacket", jacketsNoReview);
    expect(without.state).toBe("no_match");
    expect(without.message).toMatch(/letter sizes are not converted/);
  });

  it("chest without length and EU sizes go to review, not match", () => {
    expect(evalJacket("44").state).toBe("review");
    expect(evalJacket("IT 54").state).toBe("review");
    expect(evalJacket("IT 54").message).toMatch(/usually corresponds to US 44/);
    expect(evalJacket("IT 50").state).toBe("no_match");
    expect(evalJacket("54").state).toBe("review");
  });

  it("letter sizes on shirts don't use jacket sizes and vice versa", () => {
    expect(evaluateSize(readListingSize({ sizeAspect: "L", title: "" }), jackets, "tailored", "jacket").state).toBe("no_match");
    expect(evaluateSize(readListingSize({ sizeAspect: "44R", title: "" }), shirts, "alpha", "shirt").state).toBe("review");
  });

  it("Large Tall is not Large", () => {
    const r = evalShirt("L Tall");
    expect(r.state).toBe("no_match");
    expect(r.message).toMatch(/not the same as L/);
  });
});

describe("missing and ambiguous size information", () => {
  it("missing size is never a confirmed match", () => {
    const r = evalShirt(null, "Brunello Cucinelli sport shirt");
    expect(r.state).toBe("review");
    expect(r.message).toMatch(/Size not stated/);
  });

  it("falls back to the title and says so", () => {
    const r = evalShirt(null, "Norse Projects tee size Large");
    expect(r.state).toBe("match");
    expect(r.message).toMatch(/read from title/);
  });

  it("item specifics vs title disagreement goes to review", () => {
    expect(evalShirt("M", "Shirt size XL").state).toBe("review");
  });

  it("multi-size listings with only some accepted sizes go to review", () => {
    expect(evalShirt("M/L").state).toBe("review");
    expect(evalShirt("L/XL").state).toBe("match");
  });
});

describe("neck and sleeve sizing (button-downs)", () => {
  const noNeck: SizePrefs = { accepted: ["L", "XL"], review: [], neck: [], sleeve: [] };
  const neck165: SizePrefs = { accepted: ["L", "XL"], review: [], neck: ["16.5"], sleeve: ["34", "35"] };
  const ev = (size: string, prefs: SizePrefs) => evaluateSize(readListingSize({ sizeAspect: size, title: "" }), prefs, "alpha_neck_sleeve", "button-down shirt");

  it("neck/sleeve listings go to review until neck sizes are configured", () => {
    expect(ev("16.5/35", noNeck).state).toBe("review");
  });
  it("matches configured neck and sleeve", () => {
    expect(ev("16.5/35", neck165).state).toBe("match");
    expect(ev("16.5/34-35", neck165).state).toBe("match");
    expect(ev("15.5/33", neck165).state).toBe("no_match");
    expect(ev("16.5/32", neck165).state).toBe("no_match");
    expect(ev("L", neck165).state).toBe("match");
  });
});
