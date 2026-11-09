import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { evaluateListing } from "../../lib/matching/engine";
import { isFatalForScan, ProviderError, type ListingProvider } from "../../lib/providers/types";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import type { ScanErrorEntry } from "../db/schema";
import { loadEngineContext, loadScanSettings } from "../services/context";
import { recomputePricing, reevaluateListings, rowToListing } from "../services/evaluation";
import { deleteListingByExternalId, purgeExpiredListings, upsertListing } from "../services/listings-write";
import { planQueries } from "./plan";
import { createProvider } from "./provider-factory";

export const HEARTBEAT_STALE_MS = 5 * 60_000;

export class ScanInProgressError extends Error {
  constructor(readonly runId: number) {
    super(`A scan is already running (#${runId}).`);
    this.name = "ScanInProgressError";
  }
}

export type ScanStatus = (typeof s.scanRuns.$inferSelect)["status"];

export interface ScanResult {
  runId: number;
  status: ScanStatus;
  mode: "live" | "fixture";
  queriesPlanned: number;
  queriesCompleted: number;
  apiCalls: number;
  detailCalls: number;
  examined: number;
  duplicates: number;
  newListings: number;
  updatedListings: number;
  unchangedListings: number;
  matchedNew: number;
  reviewNew: number;
  rejectedNew: number;
  purged: number;
  /** Saved listings re-checked via item details because their data was stale. */
  refreshedSaved: number;
  errors: ScanErrorEntry[];
  rateLimited: boolean;
}

export interface ScanOptions {
  provider?: ListingProvider;
  trigger?: "manual" | "cli" | "schedule" | "test";
  now?: () => Date;
  /** Called after each page so callers can observe progress. */
  onProgress?: (r: ScanResult) => void;
}

/** Mark scans whose heartbeat stopped (process killed / crashed) as interrupted. */
export function recoverInterruptedScans(db: AppDb, now = new Date()): number {
  const cutoff = new Date(now.getTime() - HEARTBEAT_STALE_MS);
  return db
    .update(s.scanRuns)
    .set({ status: "interrupted", finishedAt: now, notes: "Scan stopped unexpectedly (no heartbeat). Results saved up to the last completed page." })
    .where(and(eq(s.scanRuns.status, "running"), lt(s.scanRuns.heartbeatAt, cutoff)))
    .run().changes;
}

export function getRunningScan(db: AppDb) {
  return db.select().from(s.scanRuns).where(eq(s.scanRuns.status, "running")).orderBy(desc(s.scanRuns.id)).get() ?? null;
}

/** Calls made to the live API in the last 24 hours (rolling window, conservative). */
export function liveCallsLast24h(db: AppDb, now = new Date()): number {
  const since = new Date(now.getTime() - 86_400_000);
  const row = db
    .select({ n: sql<number>`coalesce(sum(${s.scanRuns.apiCalls} + ${s.scanRuns.detailCalls}), 0)` })
    .from(s.scanRuns)
    .where(and(eq(s.scanRuns.mode, "live"), gte(s.scanRuns.startedAt, since)))
    .get();
  return Number(row?.n ?? 0);
}

/**
 * Run one scan: plan queries from enabled profiles, page through results
 * (incrementally, rate-limit aware), store/dedupe listings, enrich candidates
 * with item details, evaluate matches and pricing, and record the run.
 */
export async function runScan(db: AppDb, opts: ScanOptions = {}): Promise<ScanResult> {
  const now = opts.now ?? (() => new Date());
  recoverInterruptedScans(db, now());
  const running = getRunningScan(db);
  if (running) throw new ScanInProgressError(running.id);

  const provider = opts.provider ?? createProvider(db);
  const settings = loadScanSettings(db);
  const ctx = loadEngineContext(db);
  const plan = planQueries(ctx, settings);
  const startedAt = now();
  const isLive = provider.mode === "live";

  const run = db
    .insert(s.scanRuns)
    .values({
      startedAt,
      heartbeatAt: startedAt,
      status: "running",
      mode: provider.mode,
      provider: provider.id,
      trigger: opts.trigger ?? "manual",
      queriesPlanned: plan.length,
    })
    .returning({ id: s.scanRuns.id })
    .get();

  const r: ScanResult = {
    runId: run.id,
    status: "running",
    mode: provider.mode,
    queriesPlanned: plan.length,
    queriesCompleted: 0,
    apiCalls: 0,
    detailCalls: 0,
    examined: 0,
    duplicates: 0,
    newListings: 0,
    updatedListings: 0,
    unchangedListings: 0,
    matchedNew: 0,
    reviewNew: 0,
    rejectedNew: 0,
    purged: 0,
    refreshedSaved: 0,
    errors: [],
    rateLimited: false,
  };

  const recordError = (query: string | null, err: unknown) => {
    const e = err instanceof ProviderError ? err : null;
    r.errors.push({
      at: now().toISOString(),
      query,
      code: e?.code ?? "error",
      message: err instanceof Error ? err.message : String(err),
    });
    if (e?.code === "rate_limited") r.rateLimited = true;
  };

  const heartbeat = () => {
    db.update(s.scanRuns)
      .set({
        heartbeatAt: now(),
        queriesCompleted: r.queriesCompleted,
        apiCalls: r.apiCalls,
        detailCalls: r.detailCalls,
        examined: r.examined,
        duplicates: r.duplicates,
        newListings: r.newListings,
        updatedListings: r.updatedListings,
        unchangedListings: r.unchangedListings,
        errorCount: r.errors.length,
        errors: r.errors.slice(-50),
        rateLimited: r.rateLimited,
      })
      .where(eq(s.scanRuns.id, run.id))
      .run();
    opts.onProgress?.({ ...r });
  };

  const budgetStart = isLive ? Math.max(0, settings.dailyCallBudget - liveCallsLast24h(db, startedAt)) : Number.POSITIVE_INFINITY;
  const callsUsed = () => r.apiCalls + r.detailCalls;
  const budgetLeft = () => budgetStart - callsUsed();

  const seen = new Set<string>();
  const touched = new Set<number>();
  const newIds = new Set<number>();
  let stopAll = false;
  let fatal = false;
  let budgetExhausted = false;

  try {
    for (const q of plan) {
      if (stopAll) break;
      const state = db.select().from(s.queryStates).where(eq(s.queryStates.queryKey, q.key)).get();
      const cutoff = state?.watermarkAt ? new Date(state.watermarkAt.getTime() - settings.lookbackHours * 3_600_000) : null;
      let offset = 0;
      let pages = 0;
      let newest: Date | null = state?.watermarkAt ?? null;
      let queryOk = true;

      while (pages < Math.max(1, settings.maxPagesPerQuery)) {
        if (budgetLeft() <= 0) {
          budgetExhausted = true;
          stopAll = true;
          queryOk = false;
          r.errors.push({
            at: now().toISOString(),
            query: q.description,
            code: "budget",
            message: `Daily call budget (${settings.dailyCallBudget}) reached; scan stopped early. Remaining queries will run on the next scan.`,
          });
          break;
        }
        let page;
        try {
          page = await provider.search(q, { offset, limit: Math.min(200, Math.max(1, settings.pageSize)) });
          r.apiCalls++;
        } catch (err) {
          r.apiCalls++;
          recordError(q.description, err);
          queryOk = false;
          if (isFatalForScan(err)) {
            stopAll = true;
            fatal = true;
          }
          break;
        }
        pages++;
        let reachedCutoff = false;
        const ts = now();
        db.transaction((tx) => {
          for (const item of page.items) {
            r.examined++;
            const origin = item.originAt ?? item.listedAt;
            if (origin && (!newest || origin > newest)) newest = origin;
            if (cutoff && origin && origin < cutoff) reachedCutoff = true;
            if (seen.has(item.externalId)) {
              r.duplicates++;
              // Still record that this query's category also found it.
              upsertListing(tx as unknown as AppDb, item, q.appCategoryId, ts);
              continue;
            }
            seen.add(item.externalId);
            const res = upsertListing(tx as unknown as AppDb, item, q.appCategoryId, ts);
            if (res.kind === "new") {
              r.newListings++;
              newIds.add(res.id);
              touched.add(res.id);
            } else if (res.kind === "updated") {
              r.updatedListings++;
              touched.add(res.id);
            } else {
              r.unchangedListings++;
            }
          }
        });
        heartbeat();
        if (!page.hasMore || page.nextOffset === null || reachedCutoff) break;
        offset = page.nextOffset;
      }

      db.insert(s.queryStates)
        .values({
          queryKey: q.key,
          description: q.description,
          lastRunAt: now(),
          lastSuccessAt: queryOk ? now() : state?.lastSuccessAt ?? null,
          watermarkAt: queryOk ? newest : state?.watermarkAt ?? null,
          lastStatus: queryOk ? "ok" : "error",
          lastError: queryOk ? null : r.errors[r.errors.length - 1]?.message ?? null,
        })
        .onConflictDoUpdate({
          target: s.queryStates.queryKey,
          set: {
            description: q.description,
            lastRunAt: now(),
            lastSuccessAt: queryOk ? now() : state?.lastSuccessAt ?? null,
            watermarkAt: queryOk ? newest : state?.watermarkAt ?? null,
            lastStatus: queryOk ? "ok" : "error",
            lastError: queryOk ? null : r.errors[r.errors.length - 1]?.message ?? null,
          },
        })
        .run();
      if (queryOk) r.queriesCompleted++;
    }

    // --- Enrichment: fetch item specifics (brand / size / material) for promising listings.
    if (!fatal && touched.size > 0 && settings.detailFetchLimit > 0) {
      // Prioritize listings the title alone can't settle (review), then title-only matches to confirm.
      const rank = { review: 0, match: 1, no_match: 2 } as const;
      const candidates = db
        .select()
        .from(s.listings)
        .where(and(inArray(s.listings.id, Array.from(touched)), isNull(s.listings.detailsFetchedAt)))
        .all()
        .map((row) => ({ row, ev: evaluateListing(rowToListing(row), ctx.engine) }))
        .filter(({ ev }) => ev.state !== "no_match")
        .sort((a, b) => rank[a.ev.state] - rank[b.ev.state] || (b.row.originAt?.getTime() ?? 0) - (a.row.originAt?.getTime() ?? 0))
        .slice(0, settings.detailFetchLimit);

      for (const { row } of candidates) {
        if (budgetLeft() <= 0) {
          budgetExhausted = true;
          break;
        }
        try {
          const detail = await provider.getItem(row.externalId);
          r.detailCalls++;
          if (detail.ended) {
            deleteListingByExternalId(db, row.source, row.externalId);
            touched.delete(row.id);
            newIds.delete(row.id);
            continue;
          }
          if (detail.listing) upsertListing(db, detail.listing, null, now());
        } catch (err) {
          r.detailCalls++;
          recordError(`details ${row.externalId}`, err);
          if (isFatalForScan(err)) {
            fatal = true;
            break;
          }
        }
        heartbeat();
      }
    }

    // --- Keep saved items fresh: incremental searches only revisit recent listings, so
    // re-check stale saved listings directly (eBay: displayed data ≤ 6 h old unless disclosed;
    // content no longer available must be deleted).
    if (!fatal) {
      const staleCutoff = new Date(now().getTime() - settings.staleAfterHours * 3_600_000);
      const staleSaved = db
        .select({ l: s.listings })
        .from(s.listings)
        .innerJoin(s.listingUserStates, and(eq(s.listingUserStates.source, s.listings.source), eq(s.listingUserStates.externalId, s.listings.externalId)))
        .where(and(eq(s.listings.source, provider.id === "fixture" ? "fixture" : "ebay"), eq(s.listingUserStates.saved, true), lt(s.listings.lastSeenAt, staleCutoff)))
        .limit(Math.max(0, settings.detailFetchLimit))
        .all()
        .map((r) => r.l)
        .filter((l) => !seen.has(l.externalId));
      for (const row of staleSaved) {
        if (budgetLeft() <= 0) {
          budgetExhausted = true;
          break;
        }
        try {
          const detail = await provider.getItem(row.externalId);
          r.detailCalls++;
          if (detail.ended) {
            deleteListingByExternalId(db, row.source, row.externalId);
            continue;
          }
          if (detail.listing) {
            const res = upsertListing(db, detail.listing, null, now());
            r.refreshedSaved++;
            if (res.kind === "updated") touched.add(res.id);
          }
        } catch (err) {
          r.detailCalls++;
          recordError(`refresh saved ${row.externalId}`, err);
          if (isFatalForScan(err)) {
            fatal = true;
            break;
          }
        }
      }
    }

    // --- Evaluate new/changed listings (plus anything stale under current rules).
    const touchedIds = Array.from(touched);
    const evaluated = reevaluateListings(db, { listingIds: touchedIds, context: ctx });
    reevaluateListings(db, { onlyStale: true, context: ctx });
    recomputePricing(db, { listingIds: touchedIds });
    for (const id of newIds) {
      const ev = evaluated.results.get(id);
      if (!ev) continue;
      if (ev.state === "match") r.matchedNew++;
      else if (ev.state === "review") r.reviewNew++;
      else r.rejectedNew++;
    }

    // --- Retention (eBay data-use rules): purge listings not re-confirmed recently.
    r.purged = purgeExpiredListings(db, provider.id === "fixture" ? "fixture" : "ebay", settings.retentionDays, now());

    if (fatal) r.status = r.examined > 0 ? "partial" : "failed";
    else if (r.rateLimited || budgetExhausted) r.status = "partial";
    else if (r.errors.length) r.status = "completed_with_errors";
    else r.status = "completed";
  } catch (err) {
    recordError(null, err);
    r.status = "failed";
  } finally {
    const finishedAt = now();
    db.update(s.scanRuns)
      .set({
        status: r.status === "running" ? "failed" : r.status,
        finishedAt,
        heartbeatAt: finishedAt,
        queriesCompleted: r.queriesCompleted,
        apiCalls: r.apiCalls,
        detailCalls: r.detailCalls,
        examined: r.examined,
        duplicates: r.duplicates,
        newListings: r.newListings,
        updatedListings: r.updatedListings,
        unchangedListings: r.unchangedListings,
        matchedNew: r.matchedNew,
        reviewNew: r.reviewNew,
        rejectedNew: r.rejectedNew,
        purged: r.purged,
        errorCount: r.errors.length,
        errors: r.errors.slice(-50),
        rateLimited: r.rateLimited,
        notes:
          [budgetExhausted ? "Stopped at the daily call budget." : null, r.refreshedSaved ? `Refreshed ${r.refreshedSaved} saved listing(s).` : null].filter(Boolean).join(" ") || null,
      })
      .where(eq(s.scanRuns.id, run.id))
      .run();
  }
  return r;
}
