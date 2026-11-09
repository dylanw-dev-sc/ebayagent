"use server";

import { getDb } from "@/server/db/client";
import { bool, int, money, optStr, percent, str, type ActionResult } from "@/server/form";
import { ValidationError } from "@/server/services/preferences";
import { createPricingRule, deletePricingRule, updatePricingRule } from "@/server/services/pricing";
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
