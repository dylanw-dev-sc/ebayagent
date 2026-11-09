/** Shared types for looking up typical new (retail) prices online. */

/** One store's price for the kind of item searched for. */
export interface RetailSourcePrice {
  url: string;
  domain: string;
  title: string;
  priceMinor: number;
  currency: string;
  /** "list" = the store's regular/full price; "offer" = its current selling price (could be a sale). */
  kind: "list" | "offer";
  /** Sample data (fixture mode), not a real store. */
  sample?: boolean;
}

/** A web result as returned by a search provider, with any structured offers it carried. */
export interface RetailSearchResult {
  url: string;
  title: string;
  description?: string;
  offers?: Array<{ priceMinor: number; currency: string; kind: "list" | "offer" }>;
}

export interface RetailSearchProvider {
  readonly id: "brave" | "fixture";
  /** Shown in the app; fixture results are always labeled as samples. */
  readonly label: string;
  search(query: string): Promise<RetailSearchResult[]>;
}

export interface FetchedPage {
  ok: boolean;
  status: number;
  html: string | null;
  /** Why the page wasn't read (robots.txt, timeout, too large…). */
  reason?: string;
}

export interface PageFetcher {
  fetchPage(url: string): Promise<FetchedPage>;
}

export class RetailLookupError extends Error {
  constructor(
    readonly code: "not_configured" | "auth" | "rate_limited" | "cap_reached" | "transient" | "bad_response",
    message: string,
  ) {
    super(message);
    this.name = "RetailLookupError";
  }
}
