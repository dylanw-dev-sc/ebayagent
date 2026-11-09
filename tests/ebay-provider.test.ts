import { beforeEach, describe, expect, it } from "vitest";
import type { EbayConfig } from "../src/lib/providers/ebay/config";
import { readEbayConfig } from "../src/lib/providers/ebay/config";
import { composeSize, mapItemSummary, mapShipping } from "../src/lib/providers/ebay/mapper";
import { EbayProvider } from "../src/lib/providers/ebay/provider";
import { ProviderError, ProviderRateLimitError, type ProviderQuery } from "../src/lib/providers/types";
import { runScan } from "../src/server/scanner/run";
import { memoryDb } from "./helpers";

type Call = { url: string; init?: RequestInit };
type Responder = (call: Call) => Response | Promise<Response>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

let configSeq = 0;
function config(): EbayConfig {
  // Unique client id per test so the shared token cache never leaks between tests.
  return { clientId: `test-client-${++configSeq}`, clientSecret: "test-secret", environment: "production", marketplaceId: "EBAY_US", deliveryZip: null };
}

function mockFetch(responder: Responder) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return responder(call);
  };
  return { calls, fetchImpl };
}

const tokenOk = () => json(200, { access_token: "v^1.1#token", expires_in: 7200, token_type: "Application Access Token" });
const query: ProviderQuery = {
  key: "k",
  description: "Kiton · Jackets",
  keywords: "Kiton",
  ebayCategoryId: "3001",
  appCategoryId: 3,
  brandId: 1,
  conditionIds: ["1000", "2990"],
  includeAuctions: false,
  deliveryCountry: "US",
};

const summary = {
  itemId: "v1|1234567890|0",
  legacyItemId: "1234567890",
  title: "Kiton Cashmere Sport Coat 44R",
  price: { value: "650.00", currency: "USD" },
  buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
  shippingOptions: [{ shippingCostType: "FIXED", shippingCost: { value: "15.00", currency: "USD" } }],
  image: { imageUrl: "https://i.ebayimg.com/images/g/abc/s-l1600.jpg" },
  itemWebUrl: "https://www.ebay.com/itm/1234567890",
  condition: "Pre-owned - Excellent",
  conditionId: "2990",
  leafCategoryIds: ["3001"],
  categories: [{ categoryId: "3001", categoryName: "Suits & Suit Separates" }],
  itemCreationDate: "2026-11-08T10:00:00.000Z",
  itemOriginDate: "2026-11-08T10:00:00.000Z",
};

describe("eBay configuration", () => {
  it("reads credentials only from the environment", () => {
    expect(readEbayConfig({})).toBeNull();
    expect(readEbayConfig({ EBAY_CLIENT_ID: "a", EBAY_CLIENT_SECRET: "b" })).toMatchObject({ environment: "production", marketplaceId: "EBAY_US" });
    expect(readEbayConfig({ EBAY_CLIENT_ID: "a", EBAY_CLIENT_SECRET: "b", EBAY_ENVIRONMENT: "sandbox" })!.environment).toBe("sandbox");
  });
});

describe("OAuth client-credentials token", () => {
  it("requests an application token with Basic auth and the public scope, and caches it", async () => {
    const cfg = config();
    const { calls, fetchImpl } = mockFetch(({ url }) => (url.includes("/oauth2/token") ? tokenOk() : json(200, { itemSummaries: [], total: 0 })));
    const p = new EbayProvider(cfg, { fetchImpl, minIntervalMs: 0 });
    await p.search(query, { offset: 0, limit: 50 });
    await p.search(query, { offset: 0, limit: 50 });
    const tokenCalls = calls.filter((c) => c.url.includes("/oauth2/token"));
    expect(tokenCalls).toHaveLength(1); // cached
    const t = tokenCalls[0];
    expect(t.url).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    expect(t.init?.method).toBe("POST");
    const headers = t.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(`${cfg.clientId}:test-secret`).toString("base64")}`);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(t.init?.body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe("https://api.ebay.com/oauth/api_scope");
  });

  it("maps invalid_client to an authorization error", async () => {
    const { fetchImpl } = mockFetch(() => json(401, { error: "invalid_client", error_description: "client authentication failed" }));
    const p = new EbayProvider(config(), { fetchImpl, minIntervalMs: 0 });
    await expect(p.search(query, { offset: 0, limit: 50 })).rejects.toMatchObject({ code: "auth" });
  });
});

describe("Browse search requests and mapping", () => {
  it("builds the documented search request", async () => {
    const { calls, fetchImpl } = mockFetch(({ url }) => (url.includes("/oauth2/token") ? tokenOk() : json(200, { itemSummaries: [summary], total: 1 })));
    const p = new EbayProvider(config(), { fetchImpl, minIntervalMs: 0 });
    await p.search(query, { offset: 200, limit: 200 });
    const search = calls.find((c) => c.url.includes("/item_summary/search"))!;
    const u = new URL(search.url);
    expect(u.origin + u.pathname).toBe("https://api.ebay.com/buy/browse/v1/item_summary/search");
    expect(u.searchParams.get("q")).toBe("Kiton");
    expect(u.searchParams.get("category_ids")).toBe("3001");
    expect(u.searchParams.get("sort")).toBe("newlyListed");
    expect(u.searchParams.get("limit")).toBe("200");
    expect(u.searchParams.get("offset")).toBe("200");
    expect(u.searchParams.get("filter")).toBe("conditionIds:{1000|2990},deliveryCountry:US");
    const headers = search.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer v^1.1#token");
    expect(headers["X-EBAY-C-MARKETPLACE-ID"]).toBe("EBAY_US");
  });

  it("adds a buyingOptions filter only when auctions are requested", () => {
    const p = new EbayProvider(config(), { minIntervalMs: 0 });
    expect(new URL(p.buildSearchUrl({ ...query, includeAuctions: true }, { offset: 0, limit: 10 })).searchParams.get("filter")).toContain(
      "buyingOptions:{FIXED_PRICE|AUCTION|BEST_OFFER}",
    );
  });

  it("normalizes listing fields without inventing missing data", () => {
    const l = mapItemSummary(summary)!;
    expect(l).toMatchObject({
      source: "ebay",
      externalId: "v1|1234567890|0",
      legacyId: "1234567890",
      priceMinor: 65000,
      currency: "USD",
      shippingStatus: "fixed",
      shippingMinor: 1500,
      imageUrl: summary.image.imageUrl,
      itemUrl: summary.itemWebUrl,
      conditionId: "2990",
      ebayCategoryIds: ["3001"],
      brandAspect: null,
      sizeAspect: null,
      materialAspect: null,
    });
    expect(l.listedAt?.toISOString()).toBe("2026-11-08T10:00:00.000Z");
  });

  it("maps shipping: free, fixed, calculated-without-cost, and missing", () => {
    expect(mapShipping([{ shippingCostType: "FIXED", shippingCost: { value: "0.00", currency: "USD" } }])).toMatchObject({ status: "free", minor: 0 });
    expect(mapShipping([{ shippingCostType: "CALCULATED" }])).toMatchObject({ status: "calculated", minor: null });
    expect(mapShipping(undefined)).toMatchObject({ status: "unknown", minor: null });
    expect(mapShipping([{ shippingCostType: "FIXED", shippingCost: { value: "12.00" } }, { shippingCostType: "FIXED", shippingCost: { value: "8.50" } }])).toMatchObject({
      status: "fixed",
      minor: 850,
    });
  });

  it("uses the current bid for auction-only listings", () => {
    const l = mapItemSummary({ ...summary, buyingOptions: ["AUCTION"], price: undefined, currentBidPrice: { value: "41.00", currency: "USD" } })!;
    expect(l.priceMinor).toBe(4100);
    expect(l.buyingOptions).toEqual(["AUCTION"]);
  });

  it("paginates with next/offset and handles empty results", async () => {
    let n = 0;
    const { fetchImpl } = mockFetch(({ url }) => {
      if (url.includes("/oauth2/token")) return tokenOk();
      n++;
      return n === 1 ? json(200, { itemSummaries: [summary], total: 250, limit: 200, offset: 0, next: "https://api.ebay.com/...offset=200" }) : json(200, { total: 0 });
    });
    const p = new EbayProvider(config(), { fetchImpl, minIntervalMs: 0 });
    const first = await p.search(query, { offset: 0, limit: 200 });
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(200);
    const empty = await p.search(query, { offset: 200, limit: 200 });
    expect(empty.items).toEqual([]);
    expect(empty.hasMore).toBe(false);
  });
});

describe("error handling", () => {
  it("refreshes an expired token once (errorId 1001) and retries", async () => {
    let searches = 0;
    let tokens = 0;
    const { fetchImpl } = mockFetch(({ url }) => {
      if (url.includes("/oauth2/token")) {
        tokens++;
        return tokenOk();
      }
      searches++;
      return searches === 1 ? json(401, { errors: [{ errorId: 1001, message: "Invalid access token" }] }) : json(200, { itemSummaries: [summary] });
    });
    const p = new EbayProvider(config(), { fetchImpl, minIntervalMs: 0 });
    const page = await p.search(query, { offset: 0, limit: 50 });
    expect(page.items).toHaveLength(1);
    expect(tokens).toBe(2);
  });

  it("persistent 401 → auth error", async () => {
    const { fetchImpl } = mockFetch(({ url }) => (url.includes("/oauth2/token") ? tokenOk() : json(401, { errors: [{ errorId: 1001, message: "Invalid access token" }] })));
    const p = new EbayProvider(config(), { fetchImpl, minIntervalMs: 0 });
    await expect(p.search(query, { offset: 0, limit: 50 })).rejects.toMatchObject({ code: "auth" });
  });

  it("403 errorId 1100 → access denied (keyset not enabled for Browse)", async () => {
    const { fetchImpl } = mockFetch(({ url }) =>
      url.includes("/oauth2/token") ? tokenOk() : json(403, { errors: [{ errorId: 1100, message: "Access denied", longMessage: "Insufficient permissions to fulfill the request." }] }),
    );
    const p = new EbayProvider(config(), { fetchImpl, minIntervalMs: 0 });
    const err = await p.search(query, { offset: 0, limit: 50 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe("access_denied");
    expect(err.message).toMatch(/errorId 1100/);
  });

  it("429 errorId 2001 → rate limit error with retry-after", async () => {
    const { fetchImpl } = mockFetch(({ url }) =>
      url.includes("/oauth2/token") ? tokenOk() : json(429, { errors: [{ errorId: 2001, message: "Too many requests" }] }, { "Retry-After": "60" }),
    );
    const p = new EbayProvider(config(), { fetchImpl, minIntervalMs: 0 });
    const err = await p.search(query, { offset: 0, limit: 50 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect(err.retryAfterSeconds).toBe(60);
  });

  it("retries 5xx errors, then reports a temporary error", async () => {
    let searches = 0;
    const { fetchImpl } = mockFetch(({ url }) => {
      if (url.includes("/oauth2/token")) return tokenOk();
      searches++;
      return json(503, { errors: [{ errorId: 3000, message: "Service unavailable" }] });
    });
    const p = new EbayProvider(config(), { fetchImpl, minIntervalMs: 0, maxRetries: 2 });
    await expect(p.search(query, { offset: 0, limit: 50 })).rejects.toMatchObject({ code: "transient" });
    expect(searches).toBe(3);
  });
});

describe("item details", () => {
  it("maps item specifics and composes tailored sizes", async () => {
    const detail = {
      ...summary,
      brand: "Kiton",
      size: "44",
      sizeType: "Regular",
      material: "100% Cashmere",
      categoryId: "3001",
      localizedAspects: [
        { name: "Brand", value: "Kiton", type: "STRING" },
        { name: "Size", value: "44", type: "STRING" },
        { name: "Size Type", value: "Regular", type: "STRING" },
      ],
    };
    const { calls, fetchImpl } = mockFetch(({ url }) => (url.includes("/oauth2/token") ? tokenOk() : json(200, detail)));
    const p = new EbayProvider(config(), { fetchImpl, minIntervalMs: 0 });
    const r = await p.getItem("v1|1234567890|0");
    expect(calls.at(-1)!.url).toBe("https://api.ebay.com/buy/browse/v1/item/v1%7C1234567890%7C0");
    expect(r.ended).toBe(false);
    expect(r.listing).toMatchObject({ brandAspect: "Kiton", sizeAspect: "44 Regular", materialAspect: "100% Cashmere", detailsFetched: true });
    expect(composeSize("L", "Regular")).toBe("L");
    expect(composeSize("XL", "Tall")).toBe("XL Tall");
  });

  it("404 means the listing is no longer available", async () => {
    const { fetchImpl } = mockFetch(({ url }) => (url.includes("/oauth2/token") ? tokenOk() : json(404, { errors: [{ errorId: 11001, message: "Item not found" }] })));
    const p = new EbayProvider(config(), { fetchImpl, minIntervalMs: 0 });
    expect(await p.getItem("v1|1|0")).toEqual({ externalId: "v1|1|0", listing: null, ended: true });
  });
});

describe("connection check and scanner integration", () => {
  beforeEach(() => {});

  it("reports a successful connection with remaining quota when available", async () => {
    const { fetchImpl } = mockFetch(({ url }) => {
      if (url.includes("/oauth2/token")) return tokenOk();
      if (url.includes("/rate_limit/")) return json(200, { rateLimits: [{ apiName: "Browse", resources: [{ name: "buy.browse", rates: [{ limit: 5000, remaining: 4870 }] }] }] });
      return json(200, { itemSummaries: [] });
    });
    const check = await new EbayProvider(config(), { fetchImpl, minIntervalMs: 0 }).checkConnection();
    expect(check.ok).toBe(true);
    expect(check.remainingCalls).toBe(4870);
    expect(check.callLimit).toBe(5000);
  });

  it("a scan with rejected credentials fails cleanly and stores nothing", async () => {
    const { db } = memoryDb();
    const { calls, fetchImpl } = mockFetch(() => json(401, { error: "invalid_client" }));
    const r = await runScan(db, { provider: new EbayProvider(config(), { fetchImpl, minIntervalMs: 0 }), trigger: "test" });
    expect(r.status).toBe("failed");
    expect(r.mode).toBe("live");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe("auth");
    expect(calls.length).toBe(1); // stopped after the first failure
  });

  it("a scan that hits the rate limit is partial and keeps earlier results", async () => {
    const { db } = memoryDb();
    let searches = 0;
    const { fetchImpl } = mockFetch(({ url }) => {
      if (url.includes("/oauth2/token")) return tokenOk();
      if (url.includes("/item/")) return json(200, { ...summary, brand: "Kiton", size: "44R", material: "Cashmere" });
      searches++;
      if (searches > 2) return json(429, { errors: [{ errorId: 2001, message: "Too many requests" }] });
      return json(200, { itemSummaries: [{ ...summary, itemId: `v1|${searches}|0` }] });
    });
    const r = await runScan(db, { provider: new EbayProvider(config(), { fetchImpl, minIntervalMs: 0 }), trigger: "test" });
    expect(r.status).toBe("partial");
    expect(r.rateLimited).toBe(true);
    expect(r.newListings).toBe(2);
  });
});
