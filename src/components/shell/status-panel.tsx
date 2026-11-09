import Link from "next/link";
import { SCAN_STATUS_LABEL, SCAN_STATUS_TONE, timeAgo } from "@/lib/format";
import { requestDb } from "@/server/request";
import { getSystemStatus } from "@/server/services/status";
import { Badge, Dot, Skeleton } from "../ui";
import { RunScanButton } from "./run-scan-button";

/** Compact system status: connection, data mode, last scan, counts, errors. Real values only. */
export async function StatusPanel() {
  const db = await requestDb();
  const st = getSystemStatus(db);
  const scan = st.lastScan;
  const isFixture = st.dataSource === "fixture";
  const conn = st.connection;
  const connectionLabel = isFixture
    ? "Not connected"
    : !st.provider.configured
      ? "Credentials missing"
      : conn
        ? conn.ok
          ? `Connected · checked ${timeAgo(conn.checkedAt)}`
          : `Error: ${conn.code ?? "failed"}`
        : "Configured · not yet verified";
  const connectionTone = isFixture ? "neutral" : !st.provider.configured ? "exclude" : conn ? (conn.ok ? "match" : "exclude") : "review";

  return (
    <section aria-label="System status" className="rounded-xl border border-line bg-surface p-3.5 text-[12.5px] leading-5">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">Data</span>
        {isFixture ? <Badge tone="fixture">Fixture data</Badge> : <Badge tone="match">Live eBay</Badge>}
      </div>
      <dl className="mt-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-ink-3">eBay</dt>
          <dd className="flex items-center gap-1.5 text-right text-ink-2" title={isFixture ? "Fixture mode: no eBay connection is used" : undefined}>
            <Dot tone={connectionTone} />
            {connectionLabel}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-ink-3">Last scan</dt>
          <dd className="text-right text-ink-2">
            {scan ? (
              <span className="inline-flex items-center gap-1.5">
                <Dot tone={SCAN_STATUS_TONE[scan.status]} />
                {scan.status === "running" ? "Running now" : timeAgo(scan.finishedAt ?? scan.startedAt)}
              </span>
            ) : (
              "Never"
            )}
          </dd>
        </div>
        {scan ? (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Examined</dt>
              <dd className="tabular text-ink-2">{scan.examined.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">New matches</dt>
              <dd className="tabular text-ink-2">{scan.matchedNew.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-3">Scan errors</dt>
              <dd className={scan.errorCount ? "tabular font-semibold text-exclude" : "tabular text-ink-2"}>{scan.errorCount}</dd>
            </div>
            {scan.status !== "completed" && scan.status !== "running" ? (
              <p className="text-[11.5px] text-review">{SCAN_STATUS_LABEL[scan.status]}</p>
            ) : null}
          </>
        ) : null}
        {!isFixture ? (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Calls (24 h)</dt>
            <dd className="tabular text-ink-2">
              {st.callsLast24h.toLocaleString()} / {st.dailyCallBudget.toLocaleString()}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-3.5">
        <RunScanButton initiallyRunning={!!st.runningScan} dataSource={st.dataSource} compact />
      </div>
      <Link href="/scans" className="mt-2.5 block text-center text-[12px] font-medium text-ink-3 underline-offset-4 hover:text-ink hover:underline">
        Scan history & connection
      </Link>
    </section>
  );
}

export function StatusPanelSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3.5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-9 w-full rounded-full" />
    </div>
  );
}
