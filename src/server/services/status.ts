import { and, desc, eq, sql } from "drizzle-orm";
import type { ConnectionCheck, ProviderDescription } from "../../lib/providers/types";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import { describeConfiguredProvider } from "../scanner/provider-factory";
import { getRunningScan, liveCallsLast24h, recoverInterruptedScans } from "../scanner/run";
import { loadScanSettings } from "./context";

export function saveConnectionCheck(db: AppDb, check: ConnectionCheck): void {
  db.insert(s.meta)
    .values({ key: "last_connection_check", value: JSON.stringify(check) })
    .onConflictDoUpdate({ target: s.meta.key, set: { value: JSON.stringify(check) } })
    .run();
}

export function loadConnectionCheck(db: AppDb): ConnectionCheck | null {
  const row = db.select().from(s.meta).where(eq(s.meta.key, "last_connection_check")).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as ConnectionCheck;
  } catch {
    return null;
  }
}

export interface SystemStatus {
  provider: ProviderDescription;
  dataSource: "ebay" | "fixture";
  lastScan: typeof s.scanRuns.$inferSelect | null;
  runningScan: typeof s.scanRuns.$inferSelect | null;
  callsLast24h: number;
  dailyCallBudget: number;
  connection: ConnectionCheck | null;
  totals: { listings: number; matches: number; review: number; excluded: number; saved: number };
  otherSourceListings: number;
}

/** Everything the compact status area shows. Never fabricates live statistics. */
export function getSystemStatus(db: AppDb): SystemStatus {
  recoverInterruptedScans(db);
  const provider = describeConfiguredProvider();
  const dataSource = provider.id;
  const mode = provider.mode;
  const settings = loadScanSettings(db);
  const lastScan = db.select().from(s.scanRuns).where(eq(s.scanRuns.mode, mode)).orderBy(desc(s.scanRuns.id)).get() ?? null;
  const count = (state?: string) =>
    Number(
      db
        .select({ n: sql<number>`count(*)` })
        .from(s.listings)
        .innerJoin(s.listingEvaluations, eq(s.listingEvaluations.listingId, s.listings.id))
        .where(and(eq(s.listings.source, dataSource), state ? eq(s.listingEvaluations.state, state as "match") : undefined))
        .get()?.n ?? 0,
    );
  const saved = Number(
    db
      .select({ n: sql<number>`count(*)` })
      .from(s.listingUserStates)
      .where(and(eq(s.listingUserStates.source, dataSource), eq(s.listingUserStates.saved, true)))
      .get()?.n ?? 0,
  );
  const otherSourceListings = Number(
    db
      .select({ n: sql<number>`count(*)` })
      .from(s.listings)
      .where(sql`${s.listings.source} <> ${dataSource}`)
      .get()?.n ?? 0,
  );
  return {
    provider,
    dataSource,
    lastScan,
    runningScan: getRunningScan(db),
    callsLast24h: mode === "live" ? liveCallsLast24h(db) : 0,
    dailyCallBudget: settings.dailyCallBudget,
    connection: loadConnectionCheck(db),
    totals: { listings: count(), matches: count("match"), review: count("review"), excluded: count("no_match"), saved },
    otherSourceListings,
  };
}

export function listScanRuns(db: AppDb, limit = 30) {
  return db.select().from(s.scanRuns).orderBy(desc(s.scanRuns.id)).limit(limit).all();
}
