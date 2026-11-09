import { desc } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getRunningScan, recoverInterruptedScans, runScan } from "@/server/scanner/run";

/**
 * Start a scan. The scan keeps running in this server process after the
 * response is sent; poll GET /api/status for progress. This endpoint is also
 * the hook for future scheduled scanning (e.g. a cron job POSTing here).
 */
export async function POST() {
  const db = getDb();
  recoverInterruptedScans(db);
  const running = getRunningScan(db);
  if (running) return Response.json({ ok: false, error: `A scan is already running (#${running.id}).`, runId: running.id }, { status: 409 });

  const promise = runScan(db, { trigger: "manual" });
  promise.catch((err) => console.error("[scan] failed:", err));
  // runScan records the run synchronously before its first network call.
  const latest = db.select().from(s.scanRuns).orderBy(desc(s.scanRuns.id)).get();
  return Response.json({ ok: true, runId: latest?.id ?? null, status: latest?.status ?? "running" }, { status: 202 });
}
