import { and, eq, isNull, ne } from "drizzle-orm";
import type { ListingSource } from "../../lib/domain/types";
import { computeCeilingMinor } from "../../lib/money";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import { recomputePricing } from "./evaluation";
import { ValidationError } from "./preferences";

export interface PricingRuleInput {
  categoryId: number;
  brandId: number | null;
  referenceRetailMinor: number;
  allowedBps: number;
  currency?: string;
  retailSource?: string | null;
  notes?: string | null;
  active?: boolean;
}

function validate(input: Pick<PricingRuleInput, "referenceRetailMinor" | "allowedBps">): void {
  if (!Number.isSafeInteger(input.referenceRetailMinor) || input.referenceRetailMinor <= 0) {
    throw new ValidationError("Reference retail price must be greater than $0.");
  }
  if (!Number.isInteger(input.allowedBps) || input.allowedBps <= 0 || input.allowedBps > 10000) {
    throw new ValidationError("Allowed percentage must be between 0.01% and 100%.");
  }
}

function assertUnique(db: AppDb, categoryId: number, brandId: number | null, exceptId: number | null): void {
  const clash = db
    .select()
    .from(s.pricingRules)
    .where(
      and(
        eq(s.pricingRules.categoryId, categoryId),
        brandId === null ? isNull(s.pricingRules.brandId) : eq(s.pricingRules.brandId, brandId),
        exceptId === null ? undefined : ne(s.pricingRules.id, exceptId),
      ),
    )
    .get();
  if (clash) {
    throw new ValidationError(
      brandId === null ? "A category-wide rule for this category already exists — edit it instead." : "A rule for this brand and category already exists — edit it instead.",
    );
  }
}

export function listPricingRules(db: AppDb) {
  const brands = new Map(db.select().from(s.brands).all().map((b) => [b.id, b.name]));
  const cats = new Map(db.select().from(s.categories).all().map((c) => [c.id, c.name]));
  return db
    .select()
    .from(s.pricingRules)
    .all()
    .map((r) => ({
      ...r,
      brandName: r.brandId !== null ? brands.get(r.brandId) ?? "(deleted brand)" : null,
      categoryName: cats.get(r.categoryId) ?? "(deleted category)",
      maxPriceMinor: computeCeilingMinor(r.referenceRetailMinor, r.allowedBps),
      level: r.brandId === null ? ("category" as const) : ("brand_category" as const),
    }))
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName) || (a.brandName ?? "").localeCompare(b.brandName ?? ""));
}

export function createPricingRule(db: AppDb, input: PricingRuleInput): number {
  validate(input);
  assertUnique(db, input.categoryId, input.brandId, null);
  const id = db
    .insert(s.pricingRules)
    .values({
      categoryId: input.categoryId,
      brandId: input.brandId,
      referenceRetailMinor: input.referenceRetailMinor,
      allowedBps: input.allowedBps,
      currency: input.currency ?? "USD",
      retailSource: input.retailSource?.trim() || null,
      notes: input.notes?.trim() || null,
      active: input.active ?? true,
    })
    .returning({ id: s.pricingRules.id })
    .get().id;
  recomputePricing(db);
  return id;
}

export function updatePricingRule(db: AppDb, id: number, patch: Partial<PricingRuleInput>): void {
  const existing = db.select().from(s.pricingRules).where(eq(s.pricingRules.id, id)).get();
  if (!existing) throw new ValidationError("Pricing rule not found.");
  const merged = { ...existing, ...patch };
  validate(merged);
  if (patch.categoryId !== undefined || patch.brandId !== undefined) assertUnique(db, merged.categoryId, merged.brandId, id);
  db.update(s.pricingRules)
    .set({
      categoryId: merged.categoryId,
      brandId: merged.brandId,
      referenceRetailMinor: merged.referenceRetailMinor,
      allowedBps: merged.allowedBps,
      currency: merged.currency,
      retailSource: patch.retailSource !== undefined ? patch.retailSource?.trim() || null : existing.retailSource,
      notes: patch.notes !== undefined ? patch.notes?.trim() || null : existing.notes,
      active: merged.active,
      updatedAt: new Date(),
    })
    .where(eq(s.pricingRules.id, id))
    .run();
  recomputePricing(db);
}

export function deletePricingRule(db: AppDb, id: number): void {
  db.delete(s.pricingRules).where(eq(s.pricingRules.id, id)).run();
  recomputePricing(db);
}

export function getPriceOverride(db: AppDb, source: ListingSource, externalId: string) {
  return db
    .select()
    .from(s.priceOverrides)
    .where(and(eq(s.priceOverrides.source, source), eq(s.priceOverrides.externalId, externalId)))
    .get() ?? null;
}

export function setPriceOverride(
  db: AppDb,
  source: ListingSource,
  externalId: string,
  input: { referenceRetailMinor: number; allowedBps: number; retailSource?: string | null; notes?: string | null; currency?: string },
): void {
  validate(input);
  const values = {
    source,
    externalId,
    referenceRetailMinor: input.referenceRetailMinor,
    allowedBps: input.allowedBps,
    currency: input.currency ?? "USD",
    retailSource: input.retailSource?.trim() || null,
    notes: input.notes?.trim() || null,
  };
  db.insert(s.priceOverrides)
    .values(values)
    .onConflictDoUpdate({ target: [s.priceOverrides.source, s.priceOverrides.externalId], set: values })
    .run();
  recomputePricing(db);
}

export function clearPriceOverride(db: AppDb, source: ListingSource, externalId: string): void {
  db.delete(s.priceOverrides)
    .where(and(eq(s.priceOverrides.source, source), eq(s.priceOverrides.externalId, externalId)))
    .run();
  recomputePricing(db);
}
