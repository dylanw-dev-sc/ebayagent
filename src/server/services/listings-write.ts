import { createHash } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { ListingSource, NormalizedListing } from "../../lib/domain/types";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";

/** Hash of the fields that matter for evaluation/pricing; timestamps excluded. */
export function contentHash(l: Pick<NormalizedListing, "title" | "brandAspect" | "sizeAspect" | "materialAspect" | "aspects" | "ebayCategoryIds" | "conditionText" | "conditionId" | "priceMinor" | "currency" | "shippingStatus" | "shippingMinor" | "shippingCurrency" | "buyingOptions" | "imageUrl" | "itemUrl">): string {
  return createHash("sha1")
    .update(
      JSON.stringify([
        l.title,
        l.brandAspect,
        l.sizeAspect,
        l.materialAspect,
        l.aspects,
        l.ebayCategoryIds,
        l.conditionText,
        l.conditionId,
        l.priceMinor,
        l.currency,
        l.shippingStatus,
        l.shippingMinor,
        l.shippingCurrency,
        l.buyingOptions,
        l.imageUrl,
        l.itemUrl,
      ]),
    )
    .digest("hex");
}

export type UpsertKind = "new" | "updated" | "unchanged";

/**
 * Insert or update a listing by (source, external id) — the dedupe key.
 * Search results carry no item specifics, so a summary never wipes aspects
 * previously fetched from the detail endpoint.
 */
export function upsertListing(db: AppDb, item: NormalizedListing, queryCategoryId: number | null, now: Date): { id: number; kind: UpsertKind } {
  const existing = db
    .select()
    .from(s.listings)
    .where(and(eq(s.listings.source, item.source), eq(s.listings.externalId, item.externalId)))
    .get();

  if (!existing) {
    const merged = item;
    const row = db
      .insert(s.listings)
      .values({
        source: merged.source,
        externalId: merged.externalId,
        legacyId: merged.legacyId,
        title: merged.title,
        brandAspect: merged.brandAspect,
        sizeAspect: merged.sizeAspect,
        materialAspect: merged.materialAspect,
        aspects: merged.aspects,
        ebayCategoryIds: merged.ebayCategoryIds,
        ebayCategoryPath: merged.ebayCategoryPath,
        conditionText: merged.conditionText,
        conditionId: merged.conditionId,
        priceMinor: merged.priceMinor,
        currency: merged.currency,
        shippingStatus: merged.shippingStatus,
        shippingMinor: merged.shippingMinor,
        shippingCurrency: merged.shippingCurrency,
        buyingOptions: merged.buyingOptions,
        imageUrl: merged.imageUrl,
        additionalImages: merged.additionalImageUrls,
        itemUrl: merged.itemUrl,
        listedAt: merged.listedAt,
        originAt: merged.originAt,
        queryCategoryIds: queryCategoryId !== null ? [queryCategoryId] : [],
        detailsFetchedAt: merged.detailsFetched ? now : null,
        firstSeenAt: now,
        lastSeenAt: now,
        contentHash: contentHash(merged),
      })
      .returning({ id: s.listings.id })
      .get();
    return { id: row.id, kind: "new" };
  }

  const keepDetails = !item.detailsFetched && !!existing.detailsFetchedAt;
  const merged = {
    ...item,
    brandAspect: keepDetails ? existing.brandAspect : item.brandAspect,
    sizeAspect: keepDetails ? existing.sizeAspect : item.sizeAspect,
    materialAspect: keepDetails ? existing.materialAspect : item.materialAspect,
    aspects: keepDetails ? existing.aspects : item.aspects,
    ebayCategoryIds: keepDetails && existing.ebayCategoryIds.length ? existing.ebayCategoryIds : item.ebayCategoryIds,
    ebayCategoryPath: keepDetails ? existing.ebayCategoryPath ?? item.ebayCategoryPath : item.ebayCategoryPath ?? existing.ebayCategoryPath,
  };
  const queryCategoryIds =
    queryCategoryId !== null && !existing.queryCategoryIds.includes(queryCategoryId)
      ? [...existing.queryCategoryIds, queryCategoryId]
      : existing.queryCategoryIds;
  const hash = contentHash(merged);
  const changed = hash !== existing.contentHash || queryCategoryIds.length !== existing.queryCategoryIds.length;

  if (!changed && !item.detailsFetched) {
    db.update(s.listings).set({ lastSeenAt: now }).where(eq(s.listings.id, existing.id)).run();
    return { id: existing.id, kind: "unchanged" };
  }

  db.update(s.listings)
    .set({
      legacyId: merged.legacyId ?? existing.legacyId,
      title: merged.title,
      brandAspect: merged.brandAspect,
      sizeAspect: merged.sizeAspect,
      materialAspect: merged.materialAspect,
      aspects: merged.aspects,
      ebayCategoryIds: merged.ebayCategoryIds,
      ebayCategoryPath: merged.ebayCategoryPath,
      conditionText: merged.conditionText,
      conditionId: merged.conditionId,
      priceMinor: merged.priceMinor,
      currency: merged.currency,
      shippingStatus: merged.shippingStatus,
      shippingMinor: merged.shippingMinor,
      shippingCurrency: merged.shippingCurrency,
      buyingOptions: merged.buyingOptions,
      imageUrl: merged.imageUrl ?? existing.imageUrl,
      additionalImages: merged.additionalImageUrls.length ? merged.additionalImageUrls : existing.additionalImages,
      itemUrl: merged.itemUrl ?? existing.itemUrl,
      listedAt: merged.listedAt ?? existing.listedAt,
      originAt: merged.originAt ?? existing.originAt,
      queryCategoryIds,
      detailsFetchedAt: item.detailsFetched ? now : existing.detailsFetchedAt,
      lastSeenAt: now,
      contentHash: hash,
    })
    .where(eq(s.listings.id, existing.id))
    .run();
  return { id: existing.id, kind: hash !== existing.contentHash ? "updated" : "unchanged" };
}

/**
 * eBay requires deleting content that is no longer publicly available and not
 * keeping copies longer than needed. Listings not re-confirmed by the source
 * within `retentionDays` are deleted. Saved/dismissed state is kept separately
 * (keyed by external id) and re-attaches if the item is found again.
 */
export function purgeExpiredListings(db: AppDb, source: ListingSource, retentionDays: number, now: Date): number {
  const cutoff = new Date(now.getTime() - Math.max(1, Math.min(30, retentionDays)) * 86_400_000);
  return db
    .delete(s.listings)
    .where(and(eq(s.listings.source, source), lt(s.listings.lastSeenAt, cutoff)))
    .run().changes;
}

export function deleteListingByExternalId(db: AppDb, source: ListingSource, externalId: string): number {
  return db
    .delete(s.listings)
    .where(and(eq(s.listings.source, source), eq(s.listings.externalId, externalId)))
    .run().changes;
}

export function deleteAllListingsForSource(db: AppDb, source: ListingSource): number {
  return db.delete(s.listings).where(eq(s.listings.source, source)).run().changes;
}

export function getListingsByIds(db: AppDb, ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(s.listings).where(inArray(s.listings.id, ids)).all();
}
