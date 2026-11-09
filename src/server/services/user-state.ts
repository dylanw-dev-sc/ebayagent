import { and, eq } from "drizzle-orm";
import type { ListingSource } from "../../lib/domain/types";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";

export interface UserStatePatch {
  saved?: boolean;
  dismissed?: boolean;
  reviewed?: boolean;
  note?: string | null;
}

export function getUserState(db: AppDb, source: ListingSource, externalId: string) {
  return (
    db
      .select()
      .from(s.listingUserStates)
      .where(and(eq(s.listingUserStates.source, source), eq(s.listingUserStates.externalId, externalId)))
      .get() ?? null
  );
}

/**
 * Save / dismiss / mark reviewed. Stored by (source, external id) so the
 * decision persists across sessions, repeat scans and retention purges.
 */
export function setUserState(db: AppDb, source: ListingSource, externalId: string, patch: UserStatePatch, now = new Date()) {
  const current = getUserState(db, source, externalId);
  const next = {
    source,
    externalId,
    saved: patch.saved ?? current?.saved ?? false,
    savedAt: patch.saved === undefined ? current?.savedAt ?? null : patch.saved ? now : null,
    dismissed: patch.dismissed ?? current?.dismissed ?? false,
    dismissedAt: patch.dismissed === undefined ? current?.dismissedAt ?? null : patch.dismissed ? now : null,
    reviewed: patch.reviewed ?? current?.reviewed ?? false,
    reviewedAt: patch.reviewed === undefined ? current?.reviewedAt ?? null : patch.reviewed ? now : null,
    note: patch.note === undefined ? current?.note ?? null : patch.note,
  };
  // Saving an item un-dismisses it and vice versa.
  if (patch.saved === true) {
    next.dismissed = false;
    next.dismissedAt = null;
  }
  if (patch.dismissed === true) {
    next.saved = false;
    next.savedAt = null;
  }
  db.insert(s.listingUserStates)
    .values(next)
    .onConflictDoUpdate({ target: [s.listingUserStates.source, s.listingUserStates.externalId], set: next })
    .run();
  return next;
}

export function setUserStateForListing(db: AppDb, listingId: number, patch: UserStatePatch) {
  const row = db.select({ source: s.listings.source, externalId: s.listings.externalId }).from(s.listings).where(eq(s.listings.id, listingId)).get();
  if (!row) throw new Error("Listing not found.");
  return setUserState(db, row.source, row.externalId, patch);
}
