import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { ListingForEvaluation } from "../src/lib/matching/engine";
import { openDatabase, type AppDb } from "../src/server/db/client";
import * as s from "../src/server/db/schema";
import { loadEngineContext } from "../src/server/services/context";

export function memoryDb() {
  return openDatabase(":memory:");
}

export function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ebay-finder-test-"));
  return path.join(dir, "test.db");
}

export function ctxFor(db: AppDb) {
  return loadEngineContext(db).engine;
}

export function brandId(db: AppDb, name: string): number {
  const row = db.select().from(s.brands).where(eq(s.brands.name, name)).get();
  if (!row) throw new Error(`brand ${name} not found`);
  return row.id;
}

export function categoryId(db: AppDb, slug: string): number {
  const row = db.select().from(s.categories).where(eq(s.categories.slug, slug)).get();
  if (!row) throw new Error(`category ${slug} not found`);
  return row.id;
}

export function profileId(db: AppDb, name: string): number {
  const row = db.select().from(s.searchProfiles).where(eq(s.searchProfiles.name, name)).get();
  if (!row) throw new Error(`profile ${name} not found`);
  return row.id;
}

export const EBAY_CAT = { tee: "15687", polo: "185101", casual: "57990", dress: "57991", jacket: "57988", tailored: "3001" };

export function listing(partial: Partial<ListingForEvaluation> & { title: string }): ListingForEvaluation {
  return {
    source: "fixture",
    externalId: partial.externalId ?? `T-${Math.random().toString(36).slice(2)}`,
    legacyId: null,
    brandAspect: null,
    sizeAspect: null,
    materialAspect: null,
    aspects: [],
    ebayCategoryIds: [],
    ebayCategoryPath: null,
    conditionText: "Pre-owned - Excellent",
    conditionId: "2990",
    priceMinor: 10000,
    currency: "USD",
    shippingStatus: "fixed",
    shippingMinor: 800,
    shippingCurrency: "USD",
    buyingOptions: ["FIXED_PRICE"],
    imageUrl: null,
    additionalImageUrls: [],
    itemUrl: null,
    listedAt: new Date("2026-11-01T12:00:00Z"),
    originAt: new Date("2026-11-01T12:00:00Z"),
    detailsFetched: true,
    description: null,
    queryCategoryIds: [],
    ...partial,
  };
}
