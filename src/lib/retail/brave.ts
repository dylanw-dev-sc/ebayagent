import { parseMoneyToMinor } from "../money";
import { RetailLookupError, type RetailSearchProvider, type RetailSearchResult } from "./types";

/**
 * Brave Search API (official). Key from BRAVE_SEARCH_API_KEY (.env.local) —
 * never stored in the database or sent to the browser.
 */
export const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export function readBraveKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.BRAVE_SEARCH_API_KEY?.trim() || null;
}

export class BraveRetailProvider implements RetailSearchProvider {
  readonly id = "brave" as const;
  readonly label = "Brave Search";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string): Promise<RetailSearchResult[]> {
    const url = new URL(BRAVE_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("country", "us");
    url.searchParams.set("search_lang", "en");
    url.searchParams.set("count", "20");
    url.searchParams.set("safesearch", "moderate");
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey } });
    } catch (err) {
      throw new RetailLookupError("transient", `Couldn't reach Brave Search (${err instanceof Error ? err.message : "network error"}).`);
    }
    if (res.status === 401 || res.status === 403) throw new RetailLookupError("auth", "Brave Search rejected the API key — check BRAVE_SEARCH_API_KEY in .env.local.");
    if (res.status === 429) throw new RetailLookupError("rate_limited", "Brave Search rate limit reached — lookups resume on the next scan.");
    if (!res.ok) throw new RetailLookupError("transient", `Brave Search error (HTTP ${res.status}).`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new RetailLookupError("bad_response", "Brave Search returned something that isn't JSON.");
    }
    return parseBraveResults(body);
  }
}

type Json = Record<string, unknown>;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v ? [v] : []);

/** Web results, plus any structured product offers Brave attached to them. */
export function parseBraveResults(body: unknown): RetailSearchResult[] {
  const results = arr((body as Json | null)?.web && ((body as Json).web as Json).results);
  return results
    .filter((r): r is Json => !!r && typeof r === "object" && typeof (r as Json).url === "string")
    .map((r) => {
      const offers: NonNullable<RetailSearchResult["offers"]> = [];
      for (const product of [...arr(r.product), ...arr(r.product_cluster)]) {
        for (const offer of arr((product as Json)?.offers)) {
          const o = offer as Json;
          const minor = typeof o.price === "number" ? Math.round(o.price * 100) : typeof o.price === "string" ? parseMoneyToMinor(o.price) : null;
          const currency = String(o.priceCurrency ?? "").toUpperCase();
          if (minor !== null && currency) offers.push({ priceMinor: minor, currency, kind: "offer" });
        }
      }
      return { url: String(r.url), title: String(r.title ?? ""), description: typeof r.description === "string" ? r.description : undefined, offers: offers.length ? offers : undefined };
    });
}
