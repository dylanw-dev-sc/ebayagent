import { ProviderError, ProviderRateLimitError } from "../types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface EbayErrorBody {
  errors?: Array<{ errorId?: number; message?: string; longMessage?: string; domain?: string }>;
  error?: string;
  error_description?: string;
}

export async function readJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function firstError(body: unknown): { errorId: number | null; message: string | null } {
  const b = (body ?? {}) as EbayErrorBody;
  const e = b.errors?.[0];
  if (e) return { errorId: e.errorId ?? null, message: e.longMessage || e.message || null };
  if (b.error) return { errorId: null, message: b.error_description ? `${b.error}: ${b.error_description}` : b.error };
  return { errorId: null, message: null };
}

/**
 * Map an unsuccessful eBay response to a typed provider error.
 * Verified against eBay's Buy API error reference:
 *  - 401 / errorId 1001: invalid access token
 *  - 403 / errorId 1100: access denied / insufficient permissions
 *  - 429 / errorId 2001: too many requests (call limit reached)
 */
export function mapEbayError(res: Response, body: unknown, context: string): ProviderError {
  const { errorId, message } = firstError(body);
  const detail = `${message ?? res.statusText ?? "Unknown error"}${errorId ? ` (errorId ${errorId})` : ""}`;
  if (res.status === 429 || errorId === 2001) {
    const retryAfter = Number(res.headers.get("retry-after"));
    return new ProviderRateLimitError(
      `eBay rate limit reached during ${context}: ${detail}. The daily call limit resets on eBay's schedule; scanning stopped to avoid further rejected calls.`,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  if (res.status === 401) {
    return new ProviderError("auth", `eBay rejected the credentials during ${context}: ${detail}.`, { status: 401 });
  }
  if (res.status === 403 || errorId === 1100) {
    return new ProviderError(
      "access_denied",
      `eBay denied access during ${context}: ${detail}. Your keyset may not be enabled for the Buy > Browse API in this environment (see README → “eBay API access”).`,
      { status: res.status },
    );
  }
  if (res.status === 404) return new ProviderError("not_found", `Not found during ${context}: ${detail}.`, { status: 404 });
  if (res.status >= 500) return new ProviderError("transient", `eBay server error during ${context}: ${detail}.`, { status: res.status, retryable: true });
  return new ProviderError("bad_request", `eBay rejected the request during ${context}: ${detail}.`, { status: res.status });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
