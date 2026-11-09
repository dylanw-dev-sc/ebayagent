import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { getSystemStatus } from "@/server/services/status";

export async function GET() {
  await connection();
  const st = getSystemStatus(getDb());
  const run = st.runningScan ?? st.lastScan;
  return Response.json({
    running: !!st.runningScan,
    dataSource: st.dataSource,
    providerLabel: st.provider.label,
    scan: run
      ? {
          id: run.id,
          status: run.status,
          queriesPlanned: run.queriesPlanned,
          queriesCompleted: run.queriesCompleted,
          examined: run.examined,
          newListings: run.newListings,
          matchedNew: run.matchedNew,
          errorCount: run.errorCount,
          finishedAt: run.finishedAt,
        }
      : null,
  });
}
