"use server";

import { getDb } from "@/server/db/client";
import { int, money, optStr, percent, type ActionResult } from "@/server/form";
import { ValidationError } from "@/server/services/preferences";
import { clearPriceOverride, setPriceOverride } from "@/server/services/pricing";
import { setUserStateForListing } from "@/server/services/user-state";
import * as s from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { run } from "./_run";
import { recordVisit } from "@/server/services/visits";
import type { ListingSource } from "@/lib/domain/types";

export async function setListingStateAction(listingId: number, patch: { saved?: boolean; dismissed?: boolean; reviewed?: boolean }): Promise<ActionResult> {
  return run(() => {
    setUserStateForListing(getDb(), listingId, patch);
  });
}

function listingKey(listingId: number) {
  const row = getDb().select({ source: s.listings.source, externalId: s.listings.externalId }).from(s.listings).where(eq(s.listings.id, listingId)).get();
  if (!row) throw new ValidationError("Listing not found (it may have been purged).");
  return row;
}

export async function setPriceOverrideAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    const listingId = int(fd, "listingId");
    if (!listingId) throw new ValidationError("Missing listing.");
    const retail = money(fd, "retail");
    const bps = percent(fd, "percent");
    if (retail === null) throw new ValidationError("Enter the reference retail price, e.g. 1450 or 1450.00.");
    if (bps === null) throw new ValidationError("Enter the allowed percentage, e.g. 35.");
    const { source, externalId } = listingKey(listingId);
    setPriceOverride(getDb(), source, externalId, { referenceRetailMinor: retail, allowedBps: bps, retailSource: optStr(fd, "source"), notes: optStr(fd, "notes") });
  }, "Override saved and price eligibility recalculated.");
}

export async function clearPriceOverrideAction(listingId: number): Promise<ActionResult> {
  return run(() => {
    const { source, externalId } = listingKey(listingId);
    clearPriceOverride(getDb(), source, externalId);
  }, "Override removed.");
}

/** Record a Finder visit (for "new since your last visit"). Doesn't refresh the page. */
export async function recordFinderVisitAction(source: ListingSource): Promise<void> {
  recordVisit(getDb(), source === "ebay" ? "ebay" : "fixture");
}
