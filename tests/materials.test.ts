import { describe, expect, it } from "vitest";
import { assessMaterials, readMaterials } from "../src/lib/matching/material";
import { ctxFor, memoryDb } from "./helpers";

const { db } = memoryDb();
const materials = ctxFor(db).materials;
const read = (title: string, materialAspect: string | null = null, aspects: Array<{ name: string; value: string }> = []) =>
  readMaterials({ title, materialAspect, aspects }, materials);
const assess = (title: string, materialAspect: string | null = null, aspects: Array<{ name: string; value: string }> = [], excluded?: string[]) =>
  assessMaterials(read(title, materialAspect, aspects), materials, excluded);

describe("fiber composition parsing", () => {
  it("parses percentages in both orders", () => {
    expect(read("", "80% Wool 20% Cashmere").components.map((c) => [c.key, c.pct])).toEqual([
      ["wool", 80],
      ["cashmere", 20],
    ]);
    expect(read("", "Wool 80% Cashmere 20%").components.map((c) => [c.key, c.pct])).toEqual([
      ["wool", 80],
      ["cashmere", 20],
    ]);
  });

  it("merino counts as wool and is very-high priority", () => {
    const a = assess("Knitted polo", "100% Merino Wool");
    expect(a.keys).toContain("merino_wool");
    expect(a.keys).toContain("wool");
    expect(a.level).toBe("very_high");
  });

  it("detects silk-cotton and cotton-wool blends", () => {
    expect(assess("", "70% Cotton 30% Silk").keys).toContain("silk_cotton_blend");
    expect(assess("", "Cotton / Wool").keys).toContain("cotton_wool_blend");
  });

  it("distinguishes stated fibers from composition", () => {
    expect(read("Cashmere blazer").status).toBe("stated");
    expect(read("", "100% Cotton").status).toBe("composition");
  });
});

describe("preferred vs avoided vs excluded fabrics", () => {
  it("polyester-heavy is flagged and ranked lower, not excluded by default", () => {
    const a = assess("Logo tee", "65% Polyester 35% Cotton");
    expect(a.heavyAvoid.map((h) => h.key)).toEqual(["polyester"]);
    expect(a.level).toBe("avoid");
    expect(a.score).toBeLessThan(assess("Logo tee", "100% Cotton").score);
  });

  it("a little polyester is not 'polyester-heavy'", () => {
    const a = assess("Blazer", "90% Wool 10% Polyester");
    expect(a.heavyAvoid).toEqual([]);
    expect(a.level).toBe("very_high");
  });

  it("acrylic-heavy is flagged", () => {
    expect(assess("Sweater", "100% Acrylic").heavyAvoid.map((h) => h.key)).toEqual(["acrylic"]);
  });

  it("an explicitly excluded material is reported as an excluded hit", () => {
    const a = assess("Sweater", "60% Acrylic 40% Wool", [], ["acrylic"]);
    expect(a.excludedHits.map((h) => h.key)).toEqual(["acrylic"]);
    expect(a.level).toBe("exclude");
  });

  it("preferred materials outrank neutral ones", () => {
    expect(assess("", "100% Cashmere").score).toBeGreaterThan(assess("", "100% Nylon").score);
    expect(assess("", "100% Suede").score).toBeGreaterThan(assess("", "100% Cashmere").score);
  });
});

describe("genuine vs faux materials and quality claims", () => {
  it("faux suede / microsuede / suede-look are not genuine suede", () => {
    for (const t of ["Faux suede jacket", "Microsuede bomber", "Suede-look trucker jacket", "Ultrasuede blazer"]) {
      const r = read(t);
      expect(r.components.map((c) => c.key)).not.toContain("suede");
      expect(r.fauxDetected).toContain("suede");
    }
    expect(read("Genuine suede bomber").components.map((c) => c.key)).toContain("suede");
  });

  it("PU / vegan leather are not genuine leather", () => {
    expect(read("PU leather biker jacket").components.map((c) => c.key)).not.toContain("leather");
    expect(read("Vegan leather jacket").fauxDetected).toContain("leather");
    expect(read("Lambskin leather jacket").components.map((c) => c.key)).toContain("leather");
  });

  it("'cashmere feel' and 'silk screen' are not fibers", () => {
    expect(read("Cashmere feel crewneck").components).toEqual([]);
    expect(read("Cashmere feel crewneck").claims.join(" ")).toMatch(/cashmere feel/);
    expect(read("Vintage silk screen print tee").components).toEqual([]);
  });

  it("quality claims are recorded separately and never become fibers", () => {
    const r = read("Premium luxury high quality shirt");
    expect(r.components).toEqual([]);
    expect(r.claims.length).toBeGreaterThanOrEqual(2);
    expect(r.status).toBe("unknown");
  });

  it("stated cotton varieties are facts, not claims", () => {
    const r = read("Supima cotton tee");
    expect(r.facts.join(" ")).toMatch(/Supima/);
    expect(r.components.map((c) => c.key)).toContain("cotton");
  });

  it("linings are ignored for the shell composition", () => {
    const r = read("", "100% Wool, lining 100% Polyester");
    expect(r.components.map((c) => c.key)).toEqual(["wool"]);
    expect(r.liningIgnored).toContain("polyester");
    const r2 = read("", "Wool", [{ name: "Lining Material", value: "Polyester" }]);
    expect(r2.components.map((c) => c.key)).toEqual(["wool"]);
  });
});

describe("seller description text", () => {
  const readDesc = (description: string) => readMaterials({ title: "Shirt", materialAspect: null, aspects: [], description }, materials);

  it("reads composition sentences", () => {
    const r = readDesc("Great shirt.\nComposition: 65% cotton, 35% polyester.");
    expect(r.components.map((c) => [c.key, c.pct, c.source])).toEqual([
      ["cotton", 65, "description"],
      ["polyester", 35, "description"],
    ]);
  });

  it("ignores packaging and unrelated sentences", () => {
    expect(readDesc("Fabric: 100% linen. Ships in a poly mailer. Check out my other cashmere sweaters!").components.map((c) => c.key)).toEqual(["linen"]);
    expect(readDesc("Check out my other cashmere sweaters! Smoke-free home.").components).toEqual([]);
  });

  it("ignores linings in descriptions too", () => {
    expect(readDesc("Shell: 100% wool. Lining: 100% polyester.").components.map((c) => c.key)).toEqual(["wool"]);
  });
});

describe("missing material information", () => {
  it("is classified as unknown, not as a mismatch", () => {
    const a = assess("Crew neck tee grey");
    expect(a.reading.status).toBe("unknown");
    expect(a.level).toBe("unknown");
    expect(a.summary).toBe("No fabric composition provided");
  });
});
