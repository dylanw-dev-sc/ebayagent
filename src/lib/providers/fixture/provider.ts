import type { BuyingOption, ItemAspect, NormalizedListing } from "../../domain/types";
import { parseMoneyToMinor } from "../../money";
import { normalizePhrase, tokenize } from "../../text";
import {
  ProviderError,
  ProviderRateLimitError,
  type ConnectionCheck,
  type ItemDetailResult,
  type ListingProvider,
  type ProviderDescription,
  type ProviderQuery,
  type SearchPage,
  type SearchPageRequest,
} from "../types";
import { composeSize } from "../ebay/mapper";
import { FIXTURE_ITEMS, FIXTURE_MAX_BATCH, type FixtureItem, type FixtureShipping } from "./data";

/**
 * Fixture provider: serves the synthetic FIXTURE_ITEMS through the same
 * interface as the live eBay provider, mimicking eBay's behaviour (search
 * results carry no item specifics; details come from getItem; Buy It Now only
 * unless auctions are requested; newest first; offset pagination).
 * It never claims to be live data.
 */

export interface FixtureProviderOptions {
  /** Items with batch ≤ this are visible (simulates new listings over successive scans). */
  batch?: number;
  /** Reference time for relative "listed" timestamps. */
  now?: Date;
  items?: FixtureItem[];
  /** Testing hooks: simulate failures. */
  failWith?: "auth" | "access_denied" | "rate_limited_after" | "transient_once" | null;
  rateLimitAfterCalls?: number;
  /** Simulate eBay ignoring the posted-date filter (reported to happen sometimes). */
  ignorePostedAfter?: boolean;
}

export function fixtureImageUrl(id: string, view?: "label"): string {
  return `/api/fixture-image/${encodeURIComponent(id)}${view ? `?view=${view}` : ""}`;
}

export class FixtureProvider implements ListingProvider {
  readonly id = "fixture" as const;
  readonly mode = "fixture" as const;
  callCount = 0;
  private readonly batch: number;
  private readonly now: Date;
  private readonly items: FixtureItem[];
  private transientFailed = false;

  constructor(private readonly opts: FixtureProviderOptions = {}) {
    this.batch = Math.min(opts.batch ?? FIXTURE_MAX_BATCH, FIXTURE_MAX_BATCH);
    this.now = opts.now ?? new Date();
    this.items = opts.items ?? FIXTURE_ITEMS;
  }

  describe(): ProviderDescription {
    return {
      id: "fixture",
      mode: "fixture",
      configured: true,
      label: "Fixture data",
      environment: null,
      message: "Synthetic sample listings for development — not real eBay data. Add eBay credentials to scan live listings.",
    };
  }

  private maybeFail(): void {
    this.callCount++;
    const f = this.opts.failWith;
    if (f === "auth") throw new ProviderError("auth", "Fixture: simulated invalid credentials (invalid_client).", { status: 401 });
    if (f === "access_denied") throw new ProviderError("access_denied", "Fixture: simulated access denied (errorId 1100).", { status: 403 });
    if (f === "rate_limited_after" && this.callCount > (this.opts.rateLimitAfterCalls ?? 0)) {
      throw new ProviderRateLimitError("Fixture: simulated rate limit (errorId 2001).", null);
    }
    if (f === "transient_once" && !this.transientFailed) {
      this.transientFailed = true;
      throw new ProviderError("transient", "Fixture: simulated temporary server error.", { status: 503, retryable: true });
    }
  }

  private visible(): FixtureItem[] {
    return this.items.filter((i) => i.batch <= this.batch);
  }

  private shippingFor(item: FixtureItem): FixtureShipping {
    let s = item.shipping;
    for (const r of item.revisions ?? []) if (r.batch <= this.batch && r.shipping) s = r.shipping;
    return s;
  }

  private priceFor(item: FixtureItem): string {
    let p = item.price;
    for (const r of item.revisions ?? []) if (r.batch <= this.batch && r.price) p = r.price;
    return p;
  }

  toListing(item: FixtureItem, withDetails: boolean): NormalizedListing {
    const currency = item.currency ?? "USD";
    const ship = this.shippingFor(item);
    const listedAt = new Date(this.now.getTime() - item.hoursAgo * 3_600_000);
    const aspects: ItemAspect[] = [];
    const d = item.details;
    if (withDetails && d) {
      if (d.brand) aspects.push({ name: "Brand", value: d.brand });
      if (d.size) aspects.push({ name: "Size", value: d.size });
      if (d.sizeType) aspects.push({ name: "Size Type", value: d.sizeType });
      if (d.material) aspects.push({ name: "Material", value: d.material });
      if (d.color) aspects.push({ name: "Color", value: d.color });
      for (const [name, value] of d.other ?? []) aspects.push({ name, value });
    }
    const size = withDetails && d?.size ? composeSize(d.size, d.sizeType ?? null) : null;
    const buyingOptions: BuyingOption[] = item.auction ? ["AUCTION"] : ["FIXED_PRICE"];
    return {
      source: "fixture",
      externalId: item.id,
      legacyId: null,
      title: item.title,
      brandAspect: withDetails ? d?.brand ?? null : null,
      sizeAspect: size,
      materialAspect: withDetails ? d?.material ?? null : null,
      aspects,
      ebayCategoryIds: [item.ebayCategoryId],
      ebayCategoryPath: null,
      conditionText: item.condition,
      conditionId: item.conditionId,
      priceMinor: parseMoneyToMinor(this.priceFor(item), currency),
      currency,
      shippingStatus: ship.type === "free" ? "free" : ship.type === "fixed" ? "fixed" : ship.type === "calculated" ? "calculated" : "unknown",
      shippingMinor: ship.type === "fixed" ? parseMoneyToMinor(ship.cost, currency) : ship.type === "free" ? 0 : null,
      shippingCurrency: ship.type === "fixed" || ship.type === "free" ? currency : null,
      buyingOptions,
      imageUrl: fixtureImageUrl(item.id),
      additionalImageUrls: item.labelText ? [fixtureImageUrl(item.id, "label")] : [],
      itemUrl: null, // fixtures never link to a (non-existent) eBay listing
      listedAt,
      originAt: listedAt,
      detailsFetched: withDetails,
      description: withDetails ? item.description ?? null : null,
      sellerFeedbackScore: item.seller?.score ?? null,
      sellerFeedbackPercent: item.seller?.percent ?? null,
    };
  }

  async search(query: ProviderQuery, page: SearchPageRequest): Promise<SearchPage> {
    this.maybeFail();
    const kw = tokenize(normalizePhrase(query.keywords));
    const matches = this.visible()
      .filter((i) => !query.ebayCategoryId || i.ebayCategoryId === query.ebayCategoryId)
      .filter((i) => query.includeAuctions || !i.auction)
      .filter((i) => !query.conditionIds.length || query.conditionIds.includes(i.conditionId))
      .filter((i) => this.opts.ignorePostedAfter || !query.postedAfter || this.now.getTime() - i.hoursAgo * 3_600_000 >= query.postedAfter.getTime())
      .filter((i) => {
        const hay = ` ${normalizePhrase(`${i.title} ${i.details?.brand ?? ""}`)} `;
        return kw.every((t) => hay.includes(` ${t} `));
      })
      .sort((a, b) => a.hoursAgo - b.hoursAgo);
    const slice = matches.slice(page.offset, page.offset + page.limit);
    const nextOffset = page.offset + page.limit;
    const hasMore = nextOffset < matches.length;
    return {
      items: slice.map((i) => this.toListing(i, false)),
      total: matches.length,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
      warnings: [],
    };
  }

  async getItem(externalId: string): Promise<ItemDetailResult> {
    this.maybeFail();
    const item = this.visible().find((i) => i.id === externalId);
    if (!item) return { externalId, listing: null, ended: true };
    return { externalId, listing: this.toListing(item, true), ended: false };
  }

  async checkConnection(): Promise<ConnectionCheck> {
    return {
      ok: true,
      code: null,
      message: "Fixture mode: no eBay connection is used. Results are synthetic sample data.",
      checkedAt: new Date().toISOString(),
    };
  }
}
