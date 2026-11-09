"use server";

import { refresh } from "next/cache";
import { getDb } from "@/server/db/client";
import type { ActionResult } from "@/server/form";
import { createProvider } from "@/server/scanner/provider-factory";
import { recomputePricing, reevaluateListings } from "@/server/services/evaluation";
import { deleteAllListingsForSource } from "@/server/services/listings-write";
import { saveConnectionCheck } from "@/server/services/status";
import { run } from "./_run";

/** Live provider: mints a token and makes one Browse call (limit=1). Fixture: no network. */
export async function testConnectionAction(): Promise<ActionResult> {
  const db = getDb();
  const check = await createProvider(db).checkConnection();
  saveConnectionCheck(db, check);
  refresh();
  return check.ok ? { ok: true, message: check.message } : { ok: false, error: check.message };
}

export async function clearFixtureDataAction(): Promise<ActionResult> {
  return run(() => `Removed ${deleteAllListingsForSource(getDb(), "fixture")} fixture listings. Saved/dismissed marks are kept.`);
}

export async function reevaluateAllAction(): Promise<ActionResult> {
  return run(() => {
    const db = getDb();
    const r = reevaluateListings(db);
    recomputePricing(db);
    return `Re-evaluated ${r.evaluated} listings from stored data (no API calls).`;
  });
}
