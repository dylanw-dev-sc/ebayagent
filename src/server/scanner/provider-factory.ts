import { and, eq, inArray } from "drizzle-orm";
import { readEbayConfig } from "../../lib/providers/ebay/config";
import { EbayProvider } from "../../lib/providers/ebay/provider";
import { FixtureProvider } from "../../lib/providers/fixture/provider";
import {
  ProviderError,
  type ConnectionCheck,
  type ItemDetailResult,
  type ListingProvider,
  type ProviderDescription,
  type SearchPage,
} from "../../lib/providers/types";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import { loadScanSettings } from "../services/context";

export type ProviderChoice = "ebay" | "fixture";

/**
 * LISTING_PROVIDER=ebay|fixture forces a provider. When unset, the live eBay
 * provider is used if EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are present,
 * otherwise clearly-labeled fixture data.
 */
export function chosenProvider(env: Record<string, string | undefined> = process.env): ProviderChoice {
  const forced = env.LISTING_PROVIDER?.trim().toLowerCase();
  if (forced === "ebay" || forced === "fixture") return forced;
  return readEbayConfig(env) ? "ebay" : "fixture";
}

/** Stand-in used when eBay is selected but credentials are missing: every call fails honestly. */
class UnconfiguredEbayProvider implements ListingProvider {
  readonly id = "ebay" as const;
  readonly mode = "live" as const;
  describe(): ProviderDescription {
    return {
      id: "ebay",
      mode: "live",
      configured: false,
      label: "eBay (not configured)",
      environment: null,
      message: "LISTING_PROVIDER=ebay but EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set.",
    };
  }
  private fail(): never {
    throw new ProviderError("not_configured", "eBay credentials are not configured. Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in .env.local (see README).");
  }
  async search(): Promise<SearchPage> {
    this.fail();
  }
  async getItem(): Promise<ItemDetailResult> {
    this.fail();
  }
  async checkConnection(): Promise<ConnectionCheck> {
    return { ok: false, code: "not_configured", message: this.describe().message, checkedAt: new Date().toISOString() };
  }
}

export function describeConfiguredProvider(env: Record<string, string | undefined> = process.env): ProviderDescription {
  if (chosenProvider(env) === "fixture") return new FixtureProvider().describe();
  const config = readEbayConfig(env);
  return config ? new EbayProvider(config).describe() : new UnconfiguredEbayProvider().describe();
}

/** Number of completed fixture scans, used to release fixture batches over time. */
function completedFixtureScans(db: AppDb): number {
  return db
    .select({ id: s.scanRuns.id })
    .from(s.scanRuns)
    .where(and(eq(s.scanRuns.mode, "fixture"), inArray(s.scanRuns.status, ["completed", "completed_with_errors", "partial"])))
    .all().length;
}

export function createProvider(db: AppDb, env: Record<string, string | undefined> = process.env): ListingProvider {
  if (chosenProvider(env) === "fixture") {
    return new FixtureProvider({ batch: completedFixtureScans(db) + 1, now: new Date() });
  }
  const config = readEbayConfig(env);
  if (!config) return new UnconfiguredEbayProvider();
  return new EbayProvider(config, { minIntervalMs: loadScanSettings(db).requestIntervalMs });
}
