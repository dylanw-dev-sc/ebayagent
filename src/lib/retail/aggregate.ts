import type { RetailSourcePrice } from "./types";

/** At least this many different stores must agree before an online price is used. */
export const MIN_STORES = 2;

export interface AggregatedPrice {
  status: "found" | "insufficient";
  /** The typical new price: the median store price (the lower middle one when even — never inflated). */
  typicalMinor: number | null;
  minMinor: number | null;
  maxMinor: number | null;
  sources: RetailSourcePrice[];
  message: string | null;
}

/**
 * One price per store (its lowest), outliers more than 3× away from the median
 * dropped, then the median. USD only.
 */
export function aggregateStorePrices(prices: RetailSourcePrice[]): AggregatedPrice {
  const byStore = new Map<string, RetailSourcePrice>();
  for (const p of prices) {
    if (p.currency !== "USD") continue;
    const current = byStore.get(p.domain);
    if (!current || p.priceMinor < current.priceMinor) byStore.set(p.domain, p);
  }
  let stores = [...byStore.values()].sort((a, b) => a.priceMinor - b.priceMinor);
  if (stores.length >= 3) {
    const mid = lowerMedian(stores);
    stores = stores.filter((p) => p.priceMinor <= mid * 3 && p.priceMinor * 3 >= mid);
  }
  if (stores.length < MIN_STORES) {
    return {
      status: "insufficient",
      typicalMinor: null,
      minMinor: null,
      maxMinor: null,
      sources: stores,
      message: `Found prices at ${stores.length} store${stores.length === 1 ? "" : "s"}; at least ${MIN_STORES} are needed.`,
    };
  }
  return {
    status: "found",
    typicalMinor: lowerMedian(stores),
    minMinor: stores[0].priceMinor,
    maxMinor: stores[stores.length - 1].priceMinor,
    sources: stores,
    message: null,
  };
}

function lowerMedian(sorted: RetailSourcePrice[]): number {
  return sorted[Math.floor((sorted.length - 1) / 2)].priceMinor;
}
