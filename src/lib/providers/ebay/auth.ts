import { ProviderError, ProviderRateLimitError } from "../types";
import { EBAY_HOSTS, EBAY_PUBLIC_SCOPE, type EbayConfig } from "./config";
import { readJsonSafe, type FetchLike } from "./http";

/**
 * OAuth client-credentials grant ("application access token").
 *   POST {host}/identity/v1/oauth2/token
 *   Authorization: Basic base64(client_id:client_secret)
 *   grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope
 * Tokens last ~2 hours (expires_in 7200). eBay limits how many tokens an app
 * may mint per day, so tokens are cached and reused until shortly before expiry.
 */

interface CachedToken {
  value: string;
  expiresAt: number;
}

const tokenCache = (globalThis as unknown as { __ebayTokenCache?: Map<string, CachedToken> }).__ebayTokenCache ?? new Map<string, CachedToken>();
(globalThis as unknown as { __ebayTokenCache?: Map<string, CachedToken> }).__ebayTokenCache = tokenCache;

export class EbayTokenManager {
  private readonly cacheKey: string;
  constructor(
    private readonly config: EbayConfig,
    private readonly fetchImpl: FetchLike,
    private readonly now: () => number = Date.now,
  ) {
    this.cacheKey = `${config.environment}:${config.clientId}`;
  }

  invalidate(): void {
    tokenCache.delete(this.cacheKey);
  }

  async getToken(): Promise<string> {
    const cached = tokenCache.get(this.cacheKey);
    if (cached && cached.expiresAt - 120_000 > this.now()) return cached.value;

    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const body = new URLSearchParams({ grant_type: "client_credentials", scope: EBAY_PUBLIC_SCOPE });
    let res: Response;
    try {
      res = await this.fetchImpl(`${EBAY_HOSTS[this.config.environment]}/identity/v1/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
        body: body.toString(),
      });
    } catch (err) {
      throw new ProviderError("transient", `Could not reach eBay's OAuth endpoint: ${(err as Error).message}`, { retryable: true });
    }
    const json = (await readJsonSafe(res)) as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
    if (!res.ok || !json?.access_token) {
      if (res.status === 429) throw new ProviderRateLimitError("eBay refused to issue an access token: too many token requests today.", null);
      if (res.status >= 500) throw new ProviderError("transient", `eBay OAuth server error (${res.status}).`, { status: res.status, retryable: true });
      const reason = json?.error ? `${json.error}${json.error_description ? ` — ${json.error_description}` : ""}` : `HTTP ${res.status}`;
      throw new ProviderError(
        "auth",
        `eBay rejected the application credentials (${reason}). Check EBAY_CLIENT_ID / EBAY_CLIENT_SECRET and that they belong to the ${this.config.environment} keyset.`,
        { status: res.status },
      );
    }
    const ttlMs = Math.max(60, Number(json.expires_in ?? 7200)) * 1000;
    tokenCache.set(this.cacheKey, { value: json.access_token, expiresAt: this.now() + ttlMs });
    return json.access_token;
  }
}
