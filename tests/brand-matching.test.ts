import { describe, expect, it } from "vitest";
import { detectBrand } from "../src/lib/matching/brand";
import { compileBrandMatcher } from "../src/lib/matching/brand";
import { brandId, ctxFor, memoryDb } from "./helpers";

const { db } = memoryDb();
const engine = ctxFor(db);
const matcher = engine.matcher;
const detect = (title: string, brandAspect: string | null = null) => detectBrand({ title, brandAspect }, matcher);
const id = (name: string) => brandId(db, name);

describe("brand matching and aliases", () => {
  it("matches canonical names case- and accent-insensitively", () => {
    expect(detect("BRUNELLO CUCINELLI cashmere polo").brandId).toBe(id("Brunello Cucinelli"));
    expect(detect("Officine Générale Benoit shirt").brandId).toBe(id("Officine Générale"));
  });

  it("matches aliases: Officine Generale, Double RL, APC / A.P.C., Valstarino, Drakes", () => {
    expect(detect("Officine Generale Lipp shirt").brandId).toBe(id("Officine Générale"));
    expect(detect("Double RL chambray work shirt").brandId).toBe(id("RRL"));
    expect(detect("RRL indigo jacket").brandId).toBe(id("RRL"));
    expect(detect("APC Petit Standard tee").brandId).toBe(id("A.P.C."));
    expect(detect("A.P.C. Jimmy t-shirt").brandId).toBe(id("A.P.C."));
    expect(detect("Valstarino suede bomber").brandId).toBe(id("Valstar"));
    expect(detect("Drakes brushed cotton shirt").brandId).toBe(id("Drake's"));
    expect(detect("Drake’s jersey tee").brandId).toBe(id("Drake's"));
    expect(detect("Ermenegildo Zegna button up").brandId).toBe(id("Zegna"));
  });

  it("matches from structured item specifics", () => {
    const d = detect("Navy knitted polo shirt", "John Smedley");
    expect(d.brandId).toBe(id("John Smedley"));
    expect(d.status).toBe("confirmed");
    expect(d.source).toBe("item_specifics");
  });
});

describe("incorrect brand-family matches", () => {
  it("ordinary Ralph Lauren / Polo Ralph Lauren never matches Purple Label", () => {
    expect(detect("Polo Ralph Lauren Custom Fit Oxford Shirt L").brandId).toBeNull();
    expect(detect("Ralph Lauren purple oxford shirt L").brandId).toBeNull();
    expect(detect("Lauren Ralph Lauren sport coat 44R").brandId).toBeNull();
  });

  it("Ralph Lauren Purple Label still matches, including word-order aliases", () => {
    expect(detect("Ralph Lauren Purple Label pique polo XL").brandId).toBe(id("Ralph Lauren Purple Label"));
    expect(detect("Purple Label Ralph Lauren cashmere blazer").brandId).toBe(id("Ralph Lauren Purple Label"));
    expect(detect("RL Purple Label silk tie shirt").brandId).toBe(id("Ralph Lauren Purple Label"));
  });

  it("The North Face Purple Label is not Ralph Lauren Purple Label", () => {
    const d = detect("The North Face Purple Label field polo shirt", "The North Face");
    expect(d.brandId).toBeNull();
    expect(d.status).toBe("none");
  });

  it("item specifics naming the parent brand don't override a different line in the title", () => {
    const d = detect("Polo Ralph Lauren Purple Label polo", "Polo Ralph Lauren");
    expect(d.brandId).toBe(id("Ralph Lauren Purple Label"));
    expect(d.status).toBe("conflict");
  });

  it("exclude phrases veto diffusion lines and unrelated namesakes", () => {
    const z = detect("Z Zegna slim fit shirt L", "Z Zegna");
    expect(z.brandId).toBe(id("Zegna"));
    expect(z.status).toBe("excluded_phrase");
    const gb = detect("Golden Bear Jack Nicklaus golf polo XL", "Golden Bear");
    expect(gb.status).toBe("excluded_phrase");
    expect(detect("Golden Bear Sportswear varsity jacket 44R").status).toBe("confirmed");
  });

  it("fabric-mill mentions are not treated as the garment brand", () => {
    const d = detect("Suitsupply Lazio blazer in Loro Piana wool 44R", "Suitsupply");
    expect(d.status).toBe("fabric_reference");
    expect(d.brandId).toBe(id("Loro Piana"));
    expect(detect("Custom suit jacket Zegna fabric 44R").status).toBe("fabric_reference");
    expect(detect("Sport coat made with Loro Piana cloth").status).toBe("fabric_reference");
    // A genuine garment mention is still a match.
    expect(detect("Loro Piana cashmere bomber jacket").status).toBe("confirmed");
  });

  it("does not match brand words embedded in other words", () => {
    expect(detect("Kitonga print shirt").brandId).toBeNull();
    expect(detect("Isaiah vintage tee").brandId).toBeNull();
  });

  it("flags conflicting brands between title and item specifics for review", () => {
    const d = detect("Valstar for Todd Snyder suede field jacket", "Valstar");
    expect(d.status).toBe("conflict");
    expect(d.brandId).toBe(id("Valstar"));
    expect(d.otherBrandIds).toContain(id("Todd Snyder"));
  });

  it("longest match wins when one brand name contains another", () => {
    const m = compileBrandMatcher([
      { id: 1, name: "Ralph Lauren", enabled: true, aliases: [], excludePhrases: [], groupIds: [] },
      { id: 2, name: "Ralph Lauren Purple Label", enabled: true, aliases: [], excludePhrases: [], groupIds: [] },
    ]);
    expect(detectBrand({ title: "Ralph Lauren Purple Label blazer", brandAspect: null }, m).brandId).toBe(2);
    expect(detectBrand({ title: "Ralph Lauren oxford shirt", brandAspect: null }, m).brandId).toBe(1);
  });
});
