/**
 * Run one scan from the command line (also the entry point for future
 * scheduled scanning, e.g. cron or a hosted worker):
 *   npm run scan
 * Uses the same provider selection as the web app (see .env.example).
 */
import { getDbHandle } from "../src/server/db/client";
import { runScan, ScanInProgressError } from "../src/server/scanner/run";
import { createProvider } from "../src/server/scanner/provider-factory";

async function main() {
  const { db, path } = getDbHandle();
  const provider = createProvider(db);
  const d = provider.describe();
  console.log(`Database: ${path}`);
  console.log(`Provider: ${d.label} (${d.mode === "fixture" ? "FIXTURE DATA — not real eBay listings" : "live"})`);
  try {
    const tty = process.stdout.isTTY;
    const r = await runScan(db, {
      provider,
      trigger: "cli",
      onProgress: tty ? (p) => process.stdout.write(`\r  queries ${p.queriesCompleted}/${p.queriesPlanned} · examined ${p.examined} · new ${p.newListings}   `) : undefined,
    });
    if (tty) process.stdout.write("\n");
    console.log(`Status: ${r.status}`);
    console.log(`Queries: ${r.queriesCompleted}/${r.queriesPlanned} · API calls: ${r.apiCalls} search + ${r.detailCalls} detail`);
    console.log(`Examined: ${r.examined} · new: ${r.newListings} · updated: ${r.updatedListings} · unchanged: ${r.unchangedListings} · duplicates: ${r.duplicates}`);
    console.log(`New listings → matches: ${r.matchedNew} · needs review: ${r.reviewNew} · not a match: ${r.rejectedNew}`);
    console.log(`Skipped (posted before the listing window): ${r.skippedOld} · removed (window/retention): ${r.purged} · saved items refreshed: ${r.refreshedSaved}`);
    for (const e of r.errors.slice(0, 10)) console.log(`  ! [${e.code}] ${e.query ?? ""} ${e.message}`);
    process.exitCode = r.status === "failed" ? 1 : 0;
  } catch (err) {
    if (err instanceof ScanInProgressError) {
      console.error(err.message);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
}

main();
