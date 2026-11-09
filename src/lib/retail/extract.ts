import { parseMoneyToMinor } from "../money";

/**
 * Prices from a store's product page, read deterministically from its schema.org
 * JSON-LD (Product / ProductGroup offers), falling back to price meta tags.
 */

export interface PagePrice {
  priceMinor: number;
  currency: string;
  /** "list" = a regular/list/strikethrough price; "offer" = the current selling price. */
  kind: "list" | "offer";
}

const MIN_MINOR = 2_000; // $20
const MAX_MINOR = 5_000_000; // $50,000

export function extractPagePrices(html: string): PagePrice[] {
  const out: PagePrice[] = [];
  for (const block of jsonLdBlocks(html)) collect(block, out, 0);
  if (!out.length) out.push(...metaPrices(html));
  return out;
}

/**
 * One price for the page, conservatively: a list price when the page shows one,
 * otherwise its lowest current price — so a sale or variant never inflates retail.
 * USD only; implausible amounts are ignored.
 */
export function pagePrice(prices: PagePrice[]): PagePrice | null {
  const usable = prices.filter((p) => p.currency === "USD" && p.priceMinor >= MIN_MINOR && p.priceMinor <= MAX_MINOR);
  const list = usable.filter((p) => p.kind === "list");
  const pool = list.length ? list : usable;
  if (!pool.length) return null;
  return pool.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a));
}

function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const raw = m[1].trim().replace(/^<!--/, "").replace(/-->$/, "").trim();
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Malformed JSON-LD is skipped.
    }
  }
  return blocks;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

function isType(node: Record<string, unknown>, type: string): boolean {
  return asArray(node["@type"]).some((t) => typeof t === "string" && (t === type || t.endsWith(`/${type}`)));
}

function collect(node: unknown, out: PagePrice[], depth: number): void {
  if (depth > 8 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out, depth + 1);
    return;
  }
  const o = node as Record<string, unknown>;
  if (o["@graph"]) collect(o["@graph"], out, depth + 1);
  if (isType(o, "Product") || isType(o, "ProductGroup")) {
    collectOffers(o.offers, out);
    if (o.hasVariant) collect(o.hasVariant, out, depth + 1);
  }
}

function money(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  if (typeof v === "string") return parseMoneyToMinor(v);
  return null;
}

function collectOffers(offers: unknown, out: PagePrice[]): void {
  for (const raw of asArray(offers)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const currency = String(o.priceCurrency ?? "").toUpperCase();
    for (const spec of asArray(o.priceSpecification)) {
      if (!spec || typeof spec !== "object") continue;
      const sp = spec as Record<string, unknown>;
      const minor = money(sp.price);
      const type = String(sp.priceType ?? "");
      const cur = String(sp.priceCurrency ?? currency).toUpperCase();
      if (minor !== null && /ListPrice|StrikethroughPrice|MSRP|SRP/i.test(type)) out.push({ priceMinor: minor, currency: cur, kind: "list" });
    }
    if (isType(o, "AggregateOffer")) {
      const low = money(o.lowPrice) ?? money(o.price);
      if (low !== null) out.push({ priceMinor: low, currency, kind: "offer" });
      if (o.offers) collectOffers(o.offers, out);
      continue;
    }
    const minor = money(o.price);
    if (minor !== null) out.push({ priceMinor: minor, currency, kind: "offer" });
  }
}

function metaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const n = name.replace(/[.:]/g, "\\$&");
    const a = html.match(new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${n}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, "i"));
    if (a) return a[1];
    const b = html.match(new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*(?:property|name)\\s*=\\s*["']${n}["']`, "i"));
    if (b) return b[1];
  }
  return null;
}

function metaPrices(html: string): PagePrice[] {
  const amount = metaContent(html, ["product:price:amount", "og:price:amount"]);
  const currency = (metaContent(html, ["product:price:currency", "og:price:currency"]) ?? "").toUpperCase();
  const minor = amount ? parseMoneyToMinor(amount) : null;
  return minor !== null && currency ? [{ priceMinor: minor, currency, kind: "offer" }] : [];
}
