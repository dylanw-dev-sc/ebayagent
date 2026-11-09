/**
 * Test the online new-price lookup with the Brave key in .env.local:
 *   npm run retail:check -- "Brunello Cucinelli men's cashmere cardigan"
 * Makes ONE Brave search (counted against your monthly cap), reads up to four
 * store pages, and prints each store's price and the typical (middle) price.
 */
import { aggregateStorePrices } from "../src/lib/retail/aggregate";
import { BraveRetailProvider, readBraveKey } from "../src/lib/retail/brave";
import { hostOf, isBlockedHost } from "../src/lib/retail/domains";
import { extractPagePrices, pagePrice } from "../src/lib/retail/extract";
import { createPageFetcher } from "../src/lib/retail/fetch-page";
import type { RetailSourcePrice } from "../src/lib/retail/types";
import { formatMoney } from "../src/lib/money";
import { getDbHandle } from "../src/server/db/client";
import { loadPricingSettings } from "../src/server/services/context";
import { lookupUsage, reserveLookup } from "../src/server/services/retail-lookup";

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error(`Usage: npm run retail:check -- "<brand> men's <material> <garment>"`);
    process.exit(1);
  }
  const key = readBraveKey();
  if (!key) {
    console.error("BRAVE_SEARCH_API_KEY is not set. Add it to .env.local (see the Cost Evaluator page → Online new prices).");
    process.exit(1);
  }
  const { db } = getDbHandle();
  if (!reserveLookup(db)) {
    console.error(`This month's lookup cap is used up (${lookupUsage(db).cap}). Lookups resume on the 1st.`);
    process.exit(1);
  }
  const blocked = loadPricingSettings(db).blockedDomains;
  const results = await new BraveRetailProvider(key).search(query);
  console.log(`Brave returned ${results.length} results for “${query}”.`);
  const fetcher = createPageFetcher();
  const prices: RetailSourcePrice[] = [];
  let pages = 0;
  for (const r of results.slice(0, 8)) {
    const domain = hostOf(r.url);
    if (!domain) continue;
    if (isBlockedHost(domain, blocked)) {
      console.log(`  - ${domain}: skipped (resale/marketplace)`);
      continue;
    }
    let price = r.offers?.length ? pagePrice(r.offers) : null;
    let note = price ? "structured offer in the search result" : "";
    if (!price && pages < 4) {
      pages++;
      const page = await fetcher.fetchPage(r.url);
      price = page.ok && page.html ? pagePrice(extractPagePrices(page.html)) : null;
      note = page.ok ? (price ? "price read from the page" : "no structured USD price on the page") : `page not read (${page.reason})`;
    }
    console.log(`  - ${domain}: ${price ? `${formatMoney(price.priceMinor)} (${price.kind === "list" ? "list price" : "current price"})` : "—"}  ${note}`);
    if (price) prices.push({ url: r.url, domain, title: r.title, priceMinor: price.priceMinor, currency: price.currency, kind: price.kind });
  }
  const agg = aggregateStorePrices(prices);
  console.log(agg.status === "found" ? `Typical new price: ${formatMoney(agg.typicalMinor)} (${agg.sources.length} stores, ${formatMoney(agg.minMinor)}–${formatMoney(agg.maxMinor)})` : `Not used: ${agg.message}`);
  const u = lookupUsage(db);
  console.log(`Lookups this month: ${u.used} of ${u.cap} (${u.remaining} left).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
