import type { NormalizedListing } from "../domain/types";

/**
 * Listing provider interface. Providers only acquire and normalize external
 * data; they contain no matching or pricing logic. Swap implementations
 * (live eBay, fixtures, a future hosted proxy) without touching the engines.
 */

export interface ProviderQuery {
  /** Stable identifier used for incremental-scan watermarks. */
  key: string;
  description: string;
  keywords: string;
  ebayCategoryId: string | null;
  appCategoryId: number;
  brandId: number;
  conditionIds: string[];
  includeAuctions: boolean;
  deliveryCountry: string | null;
}

export interface SearchPageRequest {
  offset: number;
  limit: number;
}

export interface SearchPage {
  items: NormalizedListing[];
  /** eBay says `total` is only an indicator; use hasMore/nextOffset to paginate. */
  total: number | null;
  hasMore: boolean;
  nextOffset: number | null;
  warnings: string[];
}

export interface ItemDetailResult {
  externalId: string;
  listing: NormalizedListing | null;
  /** The item is no longer available on the source (ended / removed). */
  ended: boolean;
}

export interface ProviderDescription {
  id: "ebay" | "fixture";
  mode: "live" | "fixture";
  configured: boolean;
  label: string;
  environment: string | null;
  message: string;
}

export interface ConnectionCheck {
  ok: boolean;
  code: string | null;
  message: string;
  checkedAt: string;
  remainingCalls?: number | null;
  callLimit?: number | null;
}

export interface ListingProvider {
  readonly id: "ebay" | "fixture";
  readonly mode: "live" | "fixture";
  describe(): ProviderDescription;
  search(query: ProviderQuery, page: SearchPageRequest): Promise<SearchPage>;
  getItem(externalId: string): Promise<ItemDetailResult>;
  checkConnection(): Promise<ConnectionCheck>;
}

// --- Errors ------------------------------------------------------------------------------

export type ProviderErrorCode =
  | "not_configured"
  | "auth"
  | "access_denied"
  | "rate_limited"
  | "bad_request"
  | "not_found"
  | "transient";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(code: ProviderErrorCode, message: string, opts: { status?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? false;
  }
}

export class ProviderRateLimitError extends ProviderError {
  readonly retryAfterSeconds: number | null;
  constructor(message: string, retryAfterSeconds: number | null, status = 429) {
    super("rate_limited", message, { status, retryable: false });
    this.name = "ProviderRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Errors that make every further call in this scan pointless. */
export function isFatalForScan(err: unknown): boolean {
  return err instanceof ProviderError && (err.code === "auth" || err.code === "access_denied" || err.code === "not_configured" || err.code === "rate_limited");
}
