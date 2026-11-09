import type { FetchedPage, PageFetcher, RetailSearchProvider, RetailSearchResult } from "./types";

/**
 * FIXTURE online prices — synthetic sample stores for fixture mode and tests.
 * Store names end in ".example" and every price is labeled as a sample; they
 * are not real stores or real prices.
 */

const STORES = ["sample-store-a.example", "sample-store-b.example", "sample-store-c.example", "sample-store-d.example"];

/** Arbitrary sample base prices (USD) by garment word — test values, not market data. */
const BASE: Array<[RegExp, number]> = [
  [/sport coat|blazer|overcoat|topcoat/, 2200],
  [/jacket|bomber|coat|parka|harrington|field jacket|gilet/, 1400],
  [/cardigan/, 1300],
  [/sweater|jumper|roll neck|rollneck|turtleneck|pullover|knitwear|knit polo|knitted polo/, 900],
  [/dress shirt|oxford shirt|button down|button up|sport shirt|overshirt/, 330],
  [/polo/, 260],
  [/t shirt|tshirt|tee|henley/, 140],
  [/shirt/, 300],
];
const MATERIAL_FACTOR: Array<[RegExp, number]> = [
  [/cashmere|vicuna/, 2.4],
  [/suede|leather/, 1.8],
  [/silk/, 1.5],
  [/merino|wool|linen/, 1.15],
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic sample results: 1–4 sample stores (1 store = "not enough prices"). */
export function samplePricesFor(query: string): number[] {
  const q = query.toLowerCase();
  const base = BASE.find(([re]) => re.test(q))?.[1] ?? 400;
  const factor = MATERIAL_FACTOR.find(([re]) => re.test(q))?.[1] ?? 1;
  const h = hash(q);
  const stores = 1 + (h % 4);
  return Array.from({ length: stores }, (_, i) => Math.round((base * factor * (0.9 + ((h >> (i * 3)) % 7) * 0.05)) / 5) * 5);
}

const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export class FixtureRetailProvider implements RetailSearchProvider {
  readonly id = "fixture" as const;
  readonly label = "Sample online prices (fixture data)";
  calls = 0;

  async search(query: string): Promise<RetailSearchResult[]> {
    this.calls++;
    return samplePricesFor(query).map((_, i) => ({ url: `https://${STORES[i]}/p/${slug(query)}?q=${encodeURIComponent(query)}`, title: `${query} (sample store ${i + 1})` }));
  }
}

/** Serves sample product pages with schema.org JSON-LD prices for the sample stores. */
export const fixturePageFetcher: PageFetcher = {
  async fetchPage(url: string): Promise<FetchedPage> {
    const m = url.match(/^https:\/\/sample-store-([a-d])\.example\/p\//);
    const query = m ? new URL(url).searchParams.get("q") : null;
    if (!m || !query) return { ok: false, status: 404, html: null, reason: "not a sample store" };
    const index = "abcd".indexOf(m[1]);
    const price = samplePricesFor(query)[index];
    if (price === undefined) return { ok: false, status: 404, html: null, reason: "no such sample page" };
    const ld = { "@context": "https://schema.org", "@type": "Product", name: query, offers: { "@type": "Offer", price: price.toFixed(2), priceCurrency: "USD" } };
    return { ok: true, status: 200, html: `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>Sample store</body></html>` };
  },
};
