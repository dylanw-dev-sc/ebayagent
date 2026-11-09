import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { aggregateStorePrices } from "../src/lib/retail/aggregate";
import { BraveRetailProvider, BRAVE_ENDPOINT, parseBraveResults } from "../src/lib/retail/brave";
import { DEFAULT_BLOCKED_DOMAINS, hostOf, isBlockedHost } from "../src/lib/retail/domains";
import { extractPagePrices, pagePrice } from "../src/lib/retail/extract";
import { createPageFetcher } from "../src/lib/retail/fetch-page";
import { fixturePageFetcher, FixtureRetailProvider, samplePricesFor } from "../src/lib/retail/fixture";
import { buildRetailQuery, garmentTypeFor } from "../src/lib/retail/product";
import { robotsAllows } from "../src/lib/retail/robots";
import type { RetailSourcePrice } from "../src/lib/retail/types";
import { FixtureProvider } from "../src/lib/providers/fixture/provider";
import type { AppDb } from "../src/server/db/client";
import * as s from "../src/server/db/schema";
import { runScan } from "../src/server/scanner/run";
import { createPricingRule, updatePricingSettings } from "../src/server/services/pricing";
import { productRefResolver, type ProductRef } from "../src/server/services/retail-keys";
import {
  lookUpListing,
  lookUpProduct,
  lookupCandidates,
  lookupUsage,
  reserveLookup,
  runRetailLookups,
  saveOnlinePriceAsRule,
  type RetailDeps,
} from "../src/server/services/retail-lookup";
import { brandId, categoryId, memoryDb } from "./helpers";

const ld = (obj: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head></html>`;
const fixtureDeps = (): RetailDeps & { provider: FixtureRetailProvider } => ({ provider: new FixtureRetailProvider(), fetcher: fixturePageFetcher, searchIntervalMs: 0 });
const src = (domain: string, dollars: number, currency = "USD"): RetailSourcePrice => ({ url: `https://${domain}/p`, domain, title: domain, priceMinor: dollars * 100, currency, kind: "offer" });

describe("reading a store's price from its product page", () => {
  it("reads schema.org offers, preferring a list price over a sale price", () => {
    const html = ld({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "BreadcrumbList" },
        {
          "@type": "Product",
          name: "Cashmere cardigan",
          offers: { "@type": "Offer", price: "2195.00", priceCurrency: "USD", priceSpecification: { "@type": "UnitPriceSpecification", priceType: "https://schema.org/ListPrice", price: 3450, priceCurrency: "USD" } },
        },
      ],
    });
    expect(pagePrice(extractPagePrices(html))).toEqual({ priceMinor: 345000, currency: "USD", kind: "list" });
  });

  it("takes the lowest of several offers or an AggregateOffer's low price, and falls back to price meta tags", () => {
    expect(pagePrice(extractPagePrices(ld({ "@type": "Product", offers: [{ "@type": "Offer", price: 950, priceCurrency: "USD" }, { "@type": "Offer", price: 1050, priceCurrency: "USD" }] })))?.priceMinor).toBe(95000);
    expect(pagePrice(extractPagePrices(ld({ "@type": "ProductGroup", offers: { "@type": "AggregateOffer", lowPrice: "1,295", highPrice: "1,895", priceCurrency: "USD" } })))?.priceMinor).toBe(129500);
    const meta = `<meta property="product:price:amount" content="425.00"><meta property="product:price:currency" content="USD">`;
    expect(pagePrice(extractPagePrices(meta))?.priceMinor).toBe(42500);
  });

  it("ignores other currencies, implausible amounts and broken JSON-LD", () => {
    expect(pagePrice(extractPagePrices(ld({ "@type": "Product", offers: { price: 1200, priceCurrency: "EUR" } })))).toBeNull();
    expect(pagePrice(extractPagePrices(ld({ "@type": "Product", offers: { price: 5, priceCurrency: "USD" } })))).toBeNull();
    expect(extractPagePrices(`<script type="application/ld+json">{not json</script>`)).toEqual([]);
  });
});

describe("the typical new price across stores", () => {
  it("uses each store's lowest price, drops outliers, and takes the (lower) middle price", () => {
    const r = aggregateStorePrices([src("a.com", 3000), src("a.com", 2800), src("b.com", 3200), src("c.com", 3400), src("d.com", 19000), src("e.com", 3100, "GBP")]);
    expect(r.status).toBe("found");
    expect(r.sources.map((x) => x.domain)).toEqual(["a.com", "b.com", "c.com"]); // d.com is >3× the median; e.com isn't USD
    expect(r).toMatchObject({ typicalMinor: 320000, minMinor: 280000, maxMinor: 340000 });
    expect(aggregateStorePrices([src("a.com", 3000), src("b.com", 3600)]).typicalMinor).toBe(300000);
  });

  it("needs at least two stores", () => {
    const r = aggregateStorePrices([src("a.com", 3000), src("a.com", 3100)]);
    expect(r).toMatchObject({ status: "insufficient", typicalMinor: null });
    expect(r.message).toMatch(/at least 2/);
  });
});

describe("stores and robots.txt", () => {
  it("never counts resale or marketplace sites", () => {
    expect(isBlockedHost("www.grailed.com".replace(/^www\./, ""), DEFAULT_BLOCKED_DOMAINS)).toBe(true);
    expect(isBlockedHost("shop.therealreal.com", DEFAULT_BLOCKED_DOMAINS)).toBe(true);
    expect(isBlockedHost("ebay.co.uk", [])).toBe(true); // any eBay site, always
    expect(isBlockedHost("mrporter.com", DEFAULT_BLOCKED_DOMAINS)).toBe(false);
    expect(hostOf("https://www.Example.com/x")).toBe("example.com");
    expect(hostOf("http://example.com/x")).toBeNull(); // https only
  });

  it("honors robots.txt rules", () => {
    const txt = "User-agent: *\nDisallow: /checkout\nDisallow: /search*\nAllow: /search/brands$\n\nUser-agent: ClothingFinder\nDisallow: /private";
    expect(robotsAllows(txt, "/p/cardigan", "clothingfinder")).toBe(true);
    expect(robotsAllows(txt, "/private/x", "clothingfinder")).toBe(false); // our own group applies…
    expect(robotsAllows(txt, "/checkout", "clothingfinder")).toBe(true); // …instead of "*"
    expect(robotsAllows(txt, "/search?q=a", "otherbot")).toBe(false);
    expect(robotsAllows(txt, "/search/brands", "otherbot")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow:", "/anything", "x")).toBe(true);
  });
});

describe("what gets searched (only your own words)", () => {
  it("builds the query from your brand, material and garment words — never the eBay title", () => {
    const { db } = memoryDb();
    const kindOf = productRefResolver(db);
    const knit = db.select().from(s.categories).where(eq(s.categories.slug, "knitwear")).get()!;
    const facts = { materialReading: { components: [{ key: "cashmere", pct: 100, source: "item_specifics" }], blendKeys: [] } };
    const ref = kindOf("RARE!! Brunello Cucinelli Cashmere Cardigan XL Oatmeal SECRET123 mint", { brandId: brandId(db, "Brunello Cucinelli"), categoryId: knit.id, facts })!;
    expect(ref.query).toBe("Brunello Cucinelli men's cashmere cardigan");
    for (const word of ["RARE", "Oatmeal", "SECRET123", "XL", "mint"]) expect(ref.query).not.toContain(word);
    expect(garmentTypeFor("Isaia Wool Sport Coat 44R", { titleKeywords: ["coat", "sport coat", "jacket"], noun: "jacket" })).toBe("sport coat");
    expect(buildRetailQuery({ brandQuery: "Sunspel", garmentType: "t shirt", materialName: null })).toBe("Sunspel men's t shirt");
  });
});

describe("Brave Search", () => {
  it("sends the key in its header and reads web results and any structured offers", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          web: {
            results: [
              { url: "https://store.com/p/1", title: "Cardigan", description: "d", product: { offers: [{ price: "2950.00", priceCurrency: "USD" }] } },
              { url: "https://other.com/p/2", title: "Other" },
              { title: "no url" },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const results = await new BraveRetailProvider("KEY123", fetchImpl as unknown as typeof fetch).search("Kiton men's cashmere cardigan");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url).startsWith(BRAVE_ENDPOINT)).toBe(true);
    expect(url.searchParams.get("q")).toBe("Kiton men's cashmere cardigan");
    expect(url.searchParams.get("country")).toBe("us");
    expect((init.headers as Record<string, string>)["X-Subscription-Token"]).toBe("KEY123");
    expect(results).toHaveLength(2);
    expect(results[0].offers).toEqual([{ priceMinor: 295000, currency: "USD", kind: "offer" }]);
    expect(parseBraveResults({})).toEqual([]);
  });

  it("reports a rejected key and rate limits clearly", async () => {
    const respond = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
    await expect(new BraveRetailProvider("bad", respond(401)).search("x")).rejects.toMatchObject({ code: "auth" });
    await expect(new BraveRetailProvider("k", respond(429)).search("x")).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("the monthly cap", () => {
  it("counts every search and refuses at the cap; a new month starts fresh", () => {
    const { db } = memoryDb();
    updatePricingSettings(db, { monthlyLookupCap: 2 });
    const nov = new Date("2026-11-15T12:00:00Z");
    expect(reserveLookup(db, nov)).toBe(true);
    expect(reserveLookup(db, nov)).toBe(true);
    expect(reserveLookup(db, nov)).toBe(false);
    expect(lookupUsage(db, nov)).toMatchObject({ month: "2026-11", used: 2, remaining: 0 });
    expect(reserveLookup(db, new Date("2026-12-01T00:00:01Z"))).toBe(true);
  });

  it("can be lowered but never raised past 1,000 (Brave's free monthly credit)", () => {
    const { db } = memoryDb();
    expect(lookupUsage(db).cap).toBe(1000);
    expect(() => updatePricingSettings(db, { monthlyLookupCap: 1001 })).toThrow(/0 to 1,000/);
  });
});

describe("looking up and using online prices", () => {
  const refFor = (db: AppDb, query: string): ProductRef => ({
    productKey: `test|${query}`,
    brandId: brandId(db, "Kiton"),
    categoryId: categoryId(db, "knitwear"),
    garmentType: "sweater",
    materialKey: "cashmere",
    query,
  });

  it("stores the typical price from sample stores, or why there wasn't one", async () => {
    const { db } = memoryDb();
    const deps = fixtureDeps();
    const found = await lookUpProduct(db, deps, refFor(db, "Kiton men's cashmere sweater"));
    const stores = samplePricesFor("Kiton men's cashmere sweater").length;
    expect(found.kind).toBe("done");
    if (found.kind === "done") {
      expect(found.row.status).toBe(stores >= 2 ? "found" : "insufficient");
      expect(found.row.sources.every((x) => x.sample && x.domain.endsWith(".example"))).toBe(true);
    }
    const lonely = Array.from({ length: 50 }, (_, i) => `Kiton men's test garment ${i}`).find((q) => samplePricesFor(q).length === 1)!;
    const r = await lookUpProduct(db, deps, refFor(db, lonely));
    expect(r.kind === "done" && r.row).toMatchObject({ status: "insufficient", typicalMinor: null });
    expect(lookupUsage(db).used).toBe(2);
  });

  it("stops at the monthly cap without searching", async () => {
    const { db } = memoryDb();
    updatePricingSettings(db, { monthlyLookupCap: 0 });
    const deps = fixtureDeps();
    expect(await lookUpProduct(db, deps, refFor(db, "x"))).toEqual({ kind: "cap_reached" });
    expect(deps.provider.calls).toBe(0);
  });

  it("scans look up kinds of item no price of yours covers, once, within the per-scan limit", async () => {
    const { db } = memoryDb();
    updatePricingSettings(db, { lookupsPerScan: 3 });
    const deps = fixtureDeps();
    const first = await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test", retail: deps });
    expect(first.retailLookups).toMatchObject({ looked: 3 });
    expect(deps.provider.calls).toBe(3);
    const online = db.select().from(s.pricingDecisions).all().filter((d) => d.ruleLevel === "online");
    expect(online.length).toBeGreaterThan(0);
    expect(online.every((d) => d.usesDefaultBps && d.allowedBps === 3300 && d.pctOfRetailBps !== null)).toBe(true);
    // The next scan doesn't repeat those kinds of item (cached), it moves on to others.
    const before = new Set(db.select().from(s.retailLookups).all().map((r) => r.productKey));
    await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test", retail: deps });
    const after = db.select().from(s.retailLookups).all().map((r) => r.productKey);
    expect(after.length).toBe(before.size + 3);
  });

  it("skips kinds of item your own brand price already covers, and your price wins", async () => {
    const { db } = memoryDb();
    await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test", retail: null });
    const knit = categoryId(db, "knitwear");
    const bc = brandId(db, "Brunello Cucinelli");
    expect(lookupCandidates(db, "fixture").some((c) => c.brandId === bc && c.categoryId === knit)).toBe(true);
    createPricingRule(db, { categoryId: knit, brandId: bc, referenceRetailMinor: 200000, allowedBps: null });
    expect(lookupCandidates(db, "fixture").some((c) => c.brandId === bc && c.categoryId === knit)).toBe(false);
    await runRetailLookups(db, fixtureDeps(), { source: "fixture", limit: 50 });
    const cardigan = db
      .select({ d: s.pricingDecisions })
      .from(s.pricingDecisions)
      .innerJoin(s.listings, eq(s.listings.id, s.pricingDecisions.listingId))
      .where(eq(s.listings.externalId, "FX-602"))
      .get()!.d;
    expect(cardigan.ruleLevel).toBe("brand_category");
  });

  it("a listing can be looked up on demand, and an online price saved as your own", async () => {
    const { db } = memoryDb();
    await runScan(db, { provider: new FixtureProvider({ batch: 1 }), trigger: "test", retail: null });
    const listing = db.select().from(s.listings).where(eq(s.listings.externalId, "FX-603")).get()!; // Kiton cashmere roll neck
    const message = await lookUpListing(db, fixtureDeps(), listing.id);
    const lookup = db.select().from(s.retailLookups).get()!;
    expect(lookup.query).toBe("Kiton men's cashmere roll neck");
    if (lookup.status === "found") {
      expect(message).toMatch(/typical new price of \$/);
      saveOnlinePriceAsRule(db, lookup.id);
      const rule = db.select().from(s.pricingRules).get()!;
      expect(rule).toMatchObject({ brandId: brandId(db, "Kiton"), materialKey: "cashmere", referenceRetailMinor: lookup.typicalMinor, allowedBps: null });
      expect(rule.retailSource).toMatch(/median of \d stores.*sample data/);
    } else {
      expect(message).toMatch(/needed/);
    }
  });
});

describe("reading store pages politely", () => {
  it("checks robots.txt first, only reads web pages, and caps the size", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private", { status: 200 });
      if (url.includes("/json")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      return new Response("x".repeat(5000), { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    const fetcher = createPageFetcher({ fetchImpl, minIntervalMs: 0, maxBytes: 1000 });
    expect(await fetcher.fetchPage("https://shop.test/private/p")).toMatchObject({ ok: false, reason: expect.stringMatching(/robots/) });
    expect(await fetcher.fetchPage("https://shop.test/json")).toMatchObject({ ok: false, reason: "not a web page" });
    const page = await fetcher.fetchPage("https://shop.test/p/1");
    expect(page.ok).toBe(true);
    expect(page.html!.length).toBe(1000); // capped
    expect(calls.filter((c) => c.endsWith("/robots.txt"))).toHaveLength(1); // cached per store
    expect(await fetcher.fetchPage("http://shop.test/p/1")).toMatchObject({ ok: false, reason: "not https" });
  });
});
