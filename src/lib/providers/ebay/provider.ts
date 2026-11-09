import {
  ProviderError,
  type ConnectionCheck,
  type ItemDetailResult,
  type ListingProvider,
  type ProviderDescription,
  type ProviderQuery,
  type SearchPage,
  type SearchPageRequest,
} from "../types";
import { EbayTokenManager } from "./auth";
import { EBAY_HOSTS, type EbayConfig } from "./config";
import { mapEbayError, readJsonSafe, sleep, type FetchLike } from "./http";
import { mapItemDetail, mapItemSummary, type EbayItem, type EbayItemSummary } from "./mapper";

/**
 * Official eBay Buy > Browse API provider (read-only).
 *
 * Verified behaviour (developer.ebay.com, Nov 2026):
 *  - GET /buy/browse/v1/item_summary/search with q, category_ids (ONE id per call),
 *    sort=newlyListed (ordered by itemOriginDate), limit ≤ 200, offset < 10,000
 *    and a multiple of limit; at most 10,000 results per result set.
 *  - Only Buy It Now (FIXED_PRICE) listings are returned unless a buyingOptions
 *    filter asks for AUCTION.
 *  - getItem returns brand / size / material / localizedAspects; the bulk
 *    getItems method is Limited Release, so one call per item is used.
 *  - Default Browse limit: 5,000 calls/day; 429 + errorId 2001 when exceeded.
 */

export const EBAY_MAX_LIMIT = 200;
export const EBAY_MAX_OFFSET = 9999;

export interface EbayProviderOptions {
  fetchImpl?: FetchLike;
  minIntervalMs?: number;
  maxRetries?: number;
  now?: () => number;
}

export class EbayProvider implements ListingProvider {
  readonly id = "ebay" as const;
  readonly mode = "live" as const;
  private readonly tokens: EbayTokenManager;
  private readonly fetchImpl: FetchLike;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private lastCallAt = 0;
  /** Number of HTTP calls made to the Browse/Analytics APIs (excludes token calls). */
  callCount = 0;

  constructor(
    private readonly config: EbayConfig,
    opts: EbayProviderOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.minIntervalMs = opts.minIntervalMs ?? 250;
    this.maxRetries = opts.maxRetries ?? 2;
    this.tokens = new EbayTokenManager(config, this.fetchImpl, opts.now);
  }

  describe(): ProviderDescription {
    return {
      id: "ebay",
      mode: "live",
      configured: true,
      label: this.config.environment === "sandbox" ? "eBay Sandbox" : "eBay (live)",
      environment: this.config.environment,
      message:
        this.config.environment === "sandbox"
          ? "Using the eBay Sandbox: data is test data, not real listings."
          : "Using the official eBay Browse API (EBAY_US).",
    };
  }

  private host(): string {
    return EBAY_HOSTS[this.config.environment];
  }

  private headers(token: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": this.config.marketplaceId,
    };
    if (this.config.deliveryZip) {
      h["X-EBAY-C-ENDUSERCTX"] = `contextualLocation=${encodeURIComponent(`country=US,zip=${this.config.deliveryZip}`)}`;
    }
    return h;
  }

  private async throttle(): Promise<void> {
    const wait = this.lastCallAt + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCallAt = Date.now();
  }

  /** GET with token refresh on 401 and bounded retries for transient errors. */
  private async getJson(url: string, context: string): Promise<unknown> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.tokens.getToken();
      await this.throttle();
      let res: Response;
      try {
        this.callCount++;
        res = await this.fetchImpl(url, { method: "GET", headers: this.headers(token) });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await sleep(400 * 2 ** attempt);
          continue;
        }
        throw new ProviderError("transient", `Network error during ${context}: ${(err as Error).message}`, { retryable: true });
      }
      if (res.ok) return readJsonSafe(res);
      const body = await readJsonSafe(res);
      if (res.status === 401 && !refreshed) {
        // Token expired or revoked: mint a fresh one once.
        refreshed = true;
        this.tokens.invalidate();
        continue;
      }
      const error = mapEbayError(res, body, context);
      if (error.retryable && attempt < this.maxRetries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      throw error;
    }
  }

  buildSearchUrl(query: ProviderQuery, page: SearchPageRequest): string {
    const limit = Math.min(EBAY_MAX_LIMIT, Math.max(1, page.limit));
    const params = new URLSearchParams();
    params.set("q", query.keywords);
    if (query.ebayCategoryId) params.set("category_ids", query.ebayCategoryId);
    params.set("sort", "newlyListed");
    params.set("limit", String(limit));
    params.set("offset", String(page.offset));
    const filters: string[] = [];
    if (query.conditionIds.length) filters.push(`conditionIds:{${query.conditionIds.join("|")}}`);
    if (query.includeAuctions) filters.push("buyingOptions:{FIXED_PRICE|AUCTION|BEST_OFFER}");
    if (query.deliveryCountry) filters.push(`deliveryCountry:${query.deliveryCountry}`);
    // Server-side age filter (documented Browse filter; open-ended range, UTC).
    if (query.postedAfter) filters.push(`itemStartDate:[${query.postedAfter.toISOString().replace(/\.\d{3}Z$/, "Z")}..]`);
    if (filters.length) params.set("filter", filters.join(","));
    return `${this.host()}/buy/browse/v1/item_summary/search?${params.toString()}`;
  }

  async search(query: ProviderQuery, page: SearchPageRequest): Promise<SearchPage> {
    if (page.offset > EBAY_MAX_OFFSET) return { items: [], total: null, hasMore: false, nextOffset: null, warnings: ["offset limit reached"] };
    const json = (await this.getJson(this.buildSearchUrl(query, page), `search “${query.description}”`)) as {
      itemSummaries?: EbayItemSummary[];
      total?: number;
      next?: string;
      limit?: number;
      offset?: number;
      warnings?: Array<{ message?: string }>;
    } | null;
    const items = (json?.itemSummaries ?? []).map(mapItemSummary).filter((x): x is NonNullable<typeof x> => x !== null);
    const limit = json?.limit ?? page.limit;
    const nextOffset = page.offset + limit;
    const hasMore = !!json?.next && nextOffset <= EBAY_MAX_OFFSET && items.length > 0;
    return {
      items,
      total: typeof json?.total === "number" ? json.total : null,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
      warnings: (json?.warnings ?? []).map((w) => w.message ?? "warning"),
    };
  }

  async getItem(externalId: string): Promise<ItemDetailResult> {
    try {
      const json = (await this.getJson(`${this.host()}/buy/browse/v1/item/${encodeURIComponent(externalId)}`, `item details ${externalId}`)) as EbayItem | null;
      const listing = json ? mapItemDetail(json) : null;
      const unavailable = json?.estimatedAvailabilities?.some((a) => a.estimatedAvailabilityStatus === "OUT_OF_STOCK") ?? false;
      return { externalId, listing, ended: !listing || unavailable };
    } catch (err) {
      if (err instanceof ProviderError && err.code === "not_found") return { externalId, listing: null, ended: true };
      throw err;
    }
  }

  /**
   * Validates credentials (token) and Browse access (one search call, limit 1),
   * then reads remaining quota from the Developer Analytics API (best effort).
   */
  async checkConnection(): Promise<ConnectionCheck> {
    const checkedAt = new Date().toISOString();
    try {
      await this.tokens.getToken();
    } catch (err) {
      const e = err as ProviderError;
      return { ok: false, code: e.code ?? "auth", message: e.message, checkedAt };
    }
    try {
      await this.getJson(`${this.host()}/buy/browse/v1/item_summary/search?q=shirt&limit=1`, "connection test search");
    } catch (err) {
      const e = err as ProviderError;
      return { ok: false, code: e.code ?? "unknown", message: e.message, checkedAt };
    }
    let remainingCalls: number | null = null;
    let callLimit: number | null = null;
    try {
      const json = (await this.getJson(`${this.host()}/developer/analytics/v1_beta/rate_limit/?api_context=buy`, "rate-limit lookup")) as {
        rateLimits?: Array<{ apiName?: string; resources?: Array<{ name?: string; rates?: Array<{ remaining?: number; limit?: number }> }> }>;
      } | null;
      const browse = json?.rateLimits?.find((r) => (r.apiName ?? "").toLowerCase().includes("browse"));
      const rate = browse?.resources?.find((r) => (r.name ?? "").toLowerCase().includes("browse"))?.rates?.[0] ?? browse?.resources?.[0]?.rates?.[0];
      remainingCalls = rate?.remaining ?? null;
      callLimit = rate?.limit ?? null;
    } catch {
      // Analytics is optional; connection is still valid.
    }
    return {
      ok: true,
      code: null,
      message: `Connected to eBay ${this.config.environment}: access token issued and Browse search succeeded.`,
      checkedAt,
      remainingCalls,
      callLimit,
    };
  }
}
