import { eq } from "drizzle-orm";
import type { ListingSource } from "../../lib/domain/types";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";

/**
 * "New since your last visit". A visit is a browsing session: Finder views
 * less than 30 minutes apart belong to the same session, so badges don't
 * vanish while you're still looking. A gap of 30+ minutes starts a new
 * session, and everything first seen since the previous one counts as new.
 */

export const SESSION_GAP_MS = 30 * 60_000;

interface VisitState {
  last: number;
  since: number | null;
}

const key = (source: ListingSource) => `finder_visit_${source}`;

function readVisit(db: AppDb, source: ListingSource): VisitState | null {
  const row = db.select().from(s.meta).where(eq(s.meta.key, key(source))).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as VisitState;
  } catch {
    return null;
  }
}

/** Listings first seen after this time are "new" (null on your very first visit). */
export function newSinceFor(db: AppDb, source: ListingSource, now = Date.now()): Date | null {
  const v = readVisit(db, source);
  if (!v) return null;
  if (now - v.last > SESSION_GAP_MS) return new Date(v.last); // this view starts a new session
  return v.since !== null ? new Date(v.since) : null;
}

export function recordVisit(db: AppDb, source: ListingSource, now = Date.now()): void {
  const v = readVisit(db, source);
  const next: VisitState = !v ? { last: now, since: null } : now - v.last > SESSION_GAP_MS ? { last: now, since: v.last } : { last: now, since: v.since };
  const value = JSON.stringify(next);
  db.insert(s.meta).values({ key: key(source), value }).onConflictDoUpdate({ target: s.meta.key, set: { value } }).run();
}
