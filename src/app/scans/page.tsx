import type { Metadata } from "next";
import { Suspense } from "react";
import { clearFixtureDataAction, reevaluateAllAction, testConnectionAction } from "@/app/actions/system";
import { ActionButton } from "@/components/forms";
import { RunScanButton } from "@/components/shell/run-scan-button";
import { Badge, KeyValue, PageHeader, PageSkeleton, SectionTitle } from "@/components/ui";
import { SCAN_STATUS_LABEL, SCAN_STATUS_TONE, formatDateTime, timeAgo } from "@/lib/format";
import { loadScanSettings } from "@/server/services/context";
import { getSystemStatus, listScanRuns } from "@/server/services/status";
import { requestDb } from "@/server/request";

export const metadata: Metadata = { title: "Scans & Status" };

export default function ScansPage() {
  return (
    <div className="space-y-10">
      <PageHeader title="Scans & Status" description="Connection, data source, scan history and errors. Nothing here is estimated — every number comes from recorded scans." />
      <Suspense fallback={<PageSkeleton />}>
        <ScansContent />
      </Suspense>
    </div>
  );
}

function duration(a: Date, b: Date | null) {
  if (!b) return "—";
  const s = Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function ScansContent() {
  const db = await requestDb();
  const st = getSystemStatus(db);
  const runs = listScanRuns(db, 40);
  const settings = loadScanSettings(db);
  const isFixture = st.dataSource === "fixture";
  const conn = st.connection;

  return (
    <>
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold">Data source</h2>
            {isFixture ? <Badge tone="fixture">Fixture data — synthetic</Badge> : <Badge tone="match">Live eBay ({st.provider.environment})</Badge>}
          </div>
          <p className="mt-2 text-sm leading-6 text-ink-2">{st.provider.message}</p>
          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KeyValue label="Listings stored">{st.totals.listings.toLocaleString()}</KeyValue>
            <KeyValue label="Matches">{st.totals.matches.toLocaleString()}</KeyValue>
            <KeyValue label="Needs review">{st.totals.review.toLocaleString()}</KeyValue>
            <KeyValue label="Not a match">{st.totals.excluded.toLocaleString()}</KeyValue>
          </dl>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <RunScanButton initiallyRunning={!!st.runningScan} dataSource={st.dataSource} />
            <ActionButton action={testConnectionAction}>{isFixture ? "Check data source" : "Test eBay connection"}</ActionButton>
            <ActionButton action={reevaluateAllAction} variant="ghost">
              Re-evaluate stored listings
            </ActionButton>
            {st.otherSourceListings > 0 || isFixture ? (
              <ActionButton action={clearFixtureDataAction} confirm="Delete all fixture listings? Saved/dismissed marks are kept." variant="ghost" icon="trash">
                Clear fixture listings
              </ActionButton>
            ) : null}
          </div>
          {conn ? (
            <p className={`mt-4 text-[13px] ${conn.ok ? "text-match" : "text-exclude"}`}>
              Last check {timeAgo(conn.checkedAt)}: {conn.message}
              {conn.remainingCalls !== undefined && conn.remainingCalls !== null ? ` Remaining Browse calls today: ${conn.remainingCalls.toLocaleString()} of ${conn.callLimit?.toLocaleString() ?? "?"}.` : ""}
            </p>
          ) : null}
        </div>
        <div className="card p-5">
          <h2 className="font-display text-2xl font-semibold">eBay API use</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <KeyValue label="Calls in the last 24 h">{isFixture ? "0 (fixture mode)" : `${st.callsLast24h.toLocaleString()} of ${st.dailyCallBudget.toLocaleString()} budget`}</KeyValue>
            <KeyValue label="Listing window">Only listings posted in the last {settings.maxListingAgeDays} days (by eBay&apos;s original listing date). Older ones are skipped and removed unless saved.</KeyValue>
            <KeyValue label="Per scan">
              Up to {settings.maxPagesPerQuery} page(s) × {settings.pageSize} results per brand × eBay category, plus ≤ {settings.detailFetchLimit} item-detail calls
            </KeyValue>
            <KeyValue label="Data retention">Listings not re-confirmed within {settings.retentionDays} days are deleted; ended listings are deleted when detected.</KeyValue>
            <KeyValue label="Freshness">Listing data older than {settings.staleAfterHours} h is labeled with its age.</KeyValue>
          </dl>
        </div>
      </section>

      {isFixture || !st.provider.configured ? (
        <section className="card space-y-3 p-5 text-sm leading-6 text-ink-2">
          <h2 className="font-display text-2xl font-semibold text-ink">Connect the official eBay API</h2>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Create a free account at <span className="font-medium text-ink">developer.ebay.com</span> and open <span className="font-medium text-ink">Application Keys</span>.
            </li>
            <li>Create a <span className="font-medium text-ink">Production</span> keyset. Before it activates, eBay asks you to handle Marketplace Account Deletion notifications or apply for an exemption — this app stores no eBay user (seller) data.</li>
            <li>
              Copy <code className="rounded bg-muted px-1">.env.example</code> to <code className="rounded bg-muted px-1">.env.local</code> and set <code className="rounded bg-muted px-1">EBAY_CLIENT_ID</code> (App ID) and{" "}
              <code className="rounded bg-muted px-1">EBAY_CLIENT_SECRET</code> (Cert ID). Restart the app.
            </li>
            <li>
              Run <code className="rounded bg-muted px-1">npm run ebay:check</code> or press “Test eBay connection”. A 403 / errorId 1100 means your keyset isn&apos;t enabled for the Buy &gt; Browse API yet — eBay may require applying for Buy API production access.
            </li>
          </ol>
          <p className="text-xs text-ink-3">Default Browse limit: 5,000 calls/day (raise it through eBay&apos;s free Application Growth Check). The app never scrapes eBay pages.</p>
        </section>
      ) : null}

      <section className="space-y-4">
        <SectionTitle title="Scan history" />
        {runs.length === 0 ? (
          <p className="text-sm text-ink-3">No scans yet.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-line bg-canvas text-xs text-ink-3">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Scan</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Searches</th>
                  <th className="px-4 py-2.5 font-semibold">API calls</th>
                  <th className="px-4 py-2.5 font-semibold">Examined</th>
                  <th className="px-4 py-2.5 font-semibold">New</th>
                  <th className="px-4 py-2.5 font-semibold">Updated</th>
                  <th className="px-4 py-2.5 font-semibold">New matches</th>
                  <th className="px-4 py-2.5 font-semibold">New review</th>
                  <th className="px-4 py-2.5 font-semibold">New rejected</th>
                  <th className="px-4 py-2.5 font-semibold">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">
                        #{r.id} · {formatDateTime(r.startedAt)}
                      </p>
                      <p className="text-xs text-ink-3">
                        {r.mode === "fixture" ? "Fixture" : "Live eBay"} · {r.trigger} · {duration(r.startedAt, r.finishedAt)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={SCAN_STATUS_TONE[r.status]}>{SCAN_STATUS_LABEL[r.status]}</Badge>
                      {r.rateLimited ? <p className="mt-1 text-xs text-review">Rate limited</p> : null}
                    </td>
                    <td className="px-4 py-3 tabular">
                      {r.queriesCompleted}/{r.queriesPlanned}
                    </td>
                    <td className="px-4 py-3 tabular">
                      {r.apiCalls} + {r.detailCalls}
                    </td>
                    <td className="px-4 py-3 tabular">
                      {r.examined.toLocaleString()}
                      {r.skippedOld ? <p className="text-xs text-ink-3">{r.skippedOld.toLocaleString()} older than window</p> : null}
                    </td>
                    <td className="px-4 py-3 tabular">{r.newListings.toLocaleString()}</td>
                    <td className="px-4 py-3 tabular">{r.updatedListings.toLocaleString()}</td>
                    <td className="px-4 py-3 font-semibold text-match tabular">{r.matchedNew}</td>
                    <td className="px-4 py-3 text-review tabular">{r.reviewNew}</td>
                    <td className="px-4 py-3 text-ink-3 tabular">{r.rejectedNew}</td>
                    <td className="max-w-80 px-4 py-3">
                      {r.errorCount ? (
                        <details>
                          <summary className="cursor-pointer text-exclude">{r.errorCount} error{r.errorCount > 1 ? "s" : ""}</summary>
                          <ul className="mt-2 space-y-1.5 text-xs text-ink-2">
                            {r.errors.slice(0, 10).map((e, i) => (
                              <li key={i}>
                                <span className="font-semibold">[{e.code}]</span> {e.query ? `${e.query}: ` : ""}
                                {e.message}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : (
                        <span className="text-ink-3">0</span>
                      )}
                      {r.notes ? <p className="mt-1 text-xs text-ink-3">{r.notes}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
