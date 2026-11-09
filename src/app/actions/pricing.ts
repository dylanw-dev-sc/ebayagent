"use server";

import { getDb } from "@/server/db/client";
import { bool, int, list, money, optStr, percent, str, type ActionResult } from "@/server/form";
import { ValidationError } from "@/server/services/preferences";
import { createPricingRule, deletePricingRule, updatePricingRule, updatePricingSettings } from "@/server/services/pricing";
import { refresh } from "next/cache";
import { parseMoneyToMinor, parsePercentToBps } from "@/lib/money";
import { loadBrands, loadCategories, loadPricingSettings } from "@/server/services/context";
import { describeBulkResult, importRulesCsv, saveRuleGrid, type GridCell } from "@/server/services/pricing-bulk";
import * as s from "@/server/db/schema";
import { lookUpListing, retailDepsFor, saveOnlinePriceAsRule } from "@/server/services/retail-lookup";
import { eq } from "drizzle-orm";
import { run } from "./_run";

function ruleFields(fd: FormData) {
  const categoryId = int(fd, "categoryId");
  if (!categoryId) throw new ValidationError("Choose a category.");
  const brandRaw = str(fd, "brandId");
  const retail = money(fd, "retail");
  if (retail === null) throw new ValidationError("Enter a reference retail price (e.g. 450 or 450.00).");
  const percentText = str(fd, "percent");
  const bps = percentText === "" ? null : percent(fd, "percent");
  if (percentText !== "" && bps === null) throw new ValidationError("Enter the allowed percentage of retail (e.g. 33), or leave it blank to use your default.");
  const materialRaw = str(fd, "materialKey");
  return {
    categoryId,
    brandId: brandRaw === "" ? null : Number(brandRaw),
    materialKey: materialRaw === "" ? null : materialRaw,
    referenceRetailMinor: retail,
    allowedBps: bps,
    retailSource: optStr(fd, "retailSource"),
    notes: optStr(fd, "notes"),
  };
}

export async function createRuleAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    createPricingRule(getDb(), { ...ruleFields(fd), active: true });
  }, "Rule added. Existing listings were recalculated — no new scan needed.");
}

export async function updateRuleAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    const id = int(fd, "id");
    if (!id) throw new ValidationError("Missing rule.");
    updatePricingRule(getDb(), id, { ...ruleFields(fd), active: bool(fd, "active") });
  }, "Rule saved. Listings recalculated.");
}

export async function toggleRuleAction(id: number, active: boolean): Promise<ActionResult> {
  return run(() => updatePricingRule(getDb(), id, { active }));
}

export async function deleteRuleAction(id: number): Promise<ActionResult> {
  return run(() => deletePricingRule(getDb(), id), "Rule deleted. Listings recalculated.");
}

// --- Bulk setup -----------------------------------------------------------------------

export async function saveRuleGridAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  try {
    const db = getDb();
    const categories = loadCategories(db).filter((c) => c.enabled);
    const brands = loadBrands(db).filter((b) => b.enabled);
    const cells: GridCell[] = [];
    const problems: string[] = [];
    for (const c of categories) {
      for (const brand of [null, ...brands]) {
        const k = `${c.id}_${brand?.id ?? "all"}`;
        if (!fd.has(`r_${k}`)) continue;
        const retailText = str(fd, `r_${k}`);
        const percentText = str(fd, `p_${k}`);
        const retailMinor = retailText === "" ? null : parseMoneyToMinor(retailText);
        if (retailText !== "" && retailMinor === null) {
          problems.push(`${brand?.name ?? "All brands"} / ${c.name}: “${retailText}” isn't an amount.`);
          continue;
        }
        cells.push({ categoryId: c.id, brandId: brand?.id ?? null, retailMinor, bps: percentText === "" ? null : parsePercentToBps(percentText) });
      }
    }
    // The grid's default % is your global default (also used by online prices).
    const defaultText = str(fd, "defaultPercent");
    if (defaultText !== "") {
      const d = parsePercentToBps(defaultText);
      if (d === null) throw new ValidationError(`Default % “${defaultText}” isn't a percentage.`);
      if (d !== loadPricingSettings(db).defaultAllowedBps) updatePricingSettings(db, { defaultAllowedBps: d });
    }
    const result = saveRuleGrid(db, cells, { retailSource: optStr(fd, "retailSource") });
    refresh();
    const errors = [...problems, ...result.errors];
    return errors.length
      ? { ok: false, error: `${describeBulkResult(result)} Fix: ${errors.slice(0, 6).join(" ")}${errors.length > 6 ? ` (+${errors.length - 6} more)` : ""}` }
      : { ok: true, message: describeBulkResult(result) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save the grid." };
  }
}

export async function importRulesCsvAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV file first." };
  if (file.size > 1_000_000) return { ok: false, error: "That file is too large (1 MB max)." };
  const result = importRulesCsv(getDb(), await file.text());
  refresh();
  return result.errors.length
    ? { ok: false, error: `${describeBulkResult(result)} ${result.errors.slice(0, 6).join(" ")}${result.errors.length > 6 ? ` (+${result.errors.length - 6} more)` : ""}` }
    : { ok: true, message: describeBulkResult(result) };
}

/** The deals slider's "save as my default" button. */
export async function saveDefaultPercentAction(percentValue: number): Promise<ActionResult> {
  return run(
    () => {
      updatePricingSettings(getDb(), { defaultAllowedBps: Math.round(percentValue * 100) });
    },
    `Your default is now ${percentValue}% of retail. Prices recalculated.`,
  );
}

// --- Online new prices -----------------------------------------------------------------

/** "Look up new price" in the listing view (uses one of this month's lookups). */
export async function lookUpListingAction(listingId: number): Promise<ActionResult> {
  try {
    const db = getDb();
    const source = db.select({ source: s.listings.source }).from(s.listings).where(eq(s.listings.id, listingId)).get()?.source;
    if (!source) return { ok: false, error: "Listing not found." };
    const message = await lookUpListing(db, retailDepsFor(source), listingId);
    refresh();
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lookup failed." };
  }
}

/** Save an online price as your own price for that brand + category (+ material). */
export async function saveOnlinePriceAction(lookupId: number): Promise<ActionResult> {
  return run(() => saveOnlinePriceAsRule(getDb(), lookupId));
}

export async function updateOnlineLookupSettingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(() => {
    const cap = int(fd, "monthlyLookupCap");
    const perScan = int(fd, "lookupsPerScan");
    if (cap === null) throw new ValidationError("Enter a monthly lookup cap (0–1,000).");
    if (perScan === null) throw new ValidationError("Enter how many kinds of item to look up per scan.");
    updatePricingSettings(getDb(), { onlineLookups: bool(fd, "onlineLookups"), monthlyLookupCap: cap, lookupsPerScan: perScan, blockedDomains: list(fd, "blockedDomains") });
  }, "Online price settings saved.");
}
