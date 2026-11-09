"use server";

import { getDb } from "@/server/db/client";
import { bool, int, money, optStr, percent, str, type ActionResult } from "@/server/form";
import { ValidationError } from "@/server/services/preferences";
import { createPricingRule, deletePricingRule, updatePricingRule } from "@/server/services/pricing";
import { refresh } from "next/cache";
import { parseMoneyToMinor, parsePercentToBps } from "@/lib/money";
import { loadBrands, loadCategories } from "@/server/services/context";
import { describeBulkResult, importRulesCsv, saveRuleGrid, type GridCell } from "@/server/services/pricing-bulk";
import { run } from "./_run";

function ruleFields(fd: FormData) {
  const categoryId = int(fd, "categoryId");
  if (!categoryId) throw new ValidationError("Choose a category.");
  const brandRaw = str(fd, "brandId");
  const retail = money(fd, "retail");
  if (retail === null) throw new ValidationError("Enter a reference retail price (e.g. 450 or 450.00).");
  const bps = percent(fd, "percent");
  if (bps === null) throw new ValidationError("Enter the allowed percentage of retail (e.g. 40).");
  return {
    categoryId,
    brandId: brandRaw === "" ? null : Number(brandRaw),
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
    const defaultText = str(fd, "defaultPercent");
    const result = saveRuleGrid(db, cells, { defaultBps: defaultText === "" ? null : parsePercentToBps(defaultText), retailSource: optStr(fd, "retailSource") });
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
