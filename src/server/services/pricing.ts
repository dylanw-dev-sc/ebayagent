import { and, eq, isNull, ne } from "drizzle-orm";
import type { ListingSource } from "../../lib/domain/types";
import { computeCeilingMinor } from "../../lib/money";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import type { PricingSettings } from "../db/seed-data";
import { loadPricingSettings, saveSetting } from "./context";
import { recomputePricing } from "./evaluation";
import { ValidationError } from "./preferences";

export interface PricingRuleInput {
  categoryId: number;
  brandId: number | null;
  /** Only for listings mainly made of this material; null/undefined = any material. */
  materialKey?: string | null;
  referenceRetailMinor: number;
  /** null = use your default %. */
  allowedBps: number | null;
  currency?: string;
  retailSource?: string | null;
  notes?: string | null;
  active?: boolean;
}

function validate(input: { referenceRetailMinor: number; allowedBps: number | null }): void {
  if (!Number.isSafeInteger(input.referenceRetailMinor) || input.referenceRetailMinor <= 0) {
    throw new ValidationError("Reference retail price must be greater than $0.");
  }
  if (input.allowedBps !== null && (!Number.isInteger(input.allowedBps) || input.allowedBps <= 0 || input.allowedBps > 10000)) {
    throw new ValidationError("Allowed percentage must be between 0.01% and 100% (or blank to use your default).");
  }
}

function validateMaterial(db: AppDb, materialKey: string | null): void {
  if (materialKey !== null && !db.select().from(s.materials).where(eq(s.materials.key, materialKey)).get()) {
    throw new ValidationError("Unknown material.");
  }
}

function assertUnique(db: AppDb, categoryId: number, brandId: number | null, materialKey: string | null, exceptId: number | null): void {
  const clash = db
    .select()
    .from(s.pricingRules)
    .where(
      and(
        eq(s.pricingRules.categoryId, categoryId),
        brandId === null ? isNull(s.pricingRules.brandId) : eq(s.pricingRules.brandId, brandId),
        materialKey === null ? isNull(s.pricingRules.materialKey) : eq(s.pricingRules.materialKey, materialKey),
        exceptId === null ? undefined : ne(s.pricingRules.id, exceptId),
      ),
    )
    .get();
  if (clash) {
    const what = `${brandId === null ? "A category-wide rule" : "A rule for this brand"}${materialKey ? " and material" : ""}`;
    throw new ValidationError(`${what} already exists for this category — edit it instead.`);
  }
}

export function listPricingRules(db: AppDb) {
  const brands = new Map(db.select().from(s.brands).all().map((b) => [b.id, b.name]));
  const cats = new Map(db.select().from(s.categories).all().map((c) => [c.id, c.name]));
  const materials = new Map(db.select().from(s.materials).all().map((m) => [m.key, m.name]));
  const { defaultAllowedBps } = loadPricingSettings(db);
  return db
    .select()
    .from(s.pricingRules)
    .all()
    .map((r) => ({
      ...r,
      brandName: r.brandId !== null ? brands.get(r.brandId) ?? "(deleted brand)" : null,
      categoryName: cats.get(r.categoryId) ?? "(deleted category)",
      materialName: r.materialKey !== null ? materials.get(r.materialKey) ?? r.materialKey : null,
      effectiveBps: r.allowedBps ?? defaultAllowedBps,
      maxPriceMinor: computeCeilingMinor(r.referenceRetailMinor, r.allowedBps ?? defaultAllowedBps),
      level: r.brandId === null ? ("category" as const) : ("brand_category" as const),
    }))
    .sort(
      (a, b) =>
        a.categoryName.localeCompare(b.categoryName) ||
        (a.brandName ?? "").localeCompare(b.brandName ?? "") ||
        (a.materialName ?? "").localeCompare(b.materialName ?? ""),
    );
}

export function createPricingRule(db: AppDb, input: PricingRuleInput): number {
  const materialKey = input.materialKey ?? null;
  validate(input);
  validateMaterial(db, materialKey);
  assertUnique(db, input.categoryId, input.brandId, materialKey, null);
  const id = db
    .insert(s.pricingRules)
    .values({
      categoryId: input.categoryId,
      brandId: input.brandId,
      materialKey,
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
  const merged = { ...existing, ...patch, materialKey: patch.materialKey !== undefined ? patch.materialKey : existing.materialKey };
  validate(merged);
  validateMaterial(db, merged.materialKey);
  if (patch.categoryId !== undefined || patch.brandId !== undefined || patch.materialKey !== undefined) {
    assertUnique(db, merged.categoryId, merged.brandId, merged.materialKey, id);
  }
  db.update(s.pricingRules)
    .set({
      categoryId: merged.categoryId,
      brandId: merged.brandId,
      materialKey: merged.materialKey,
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
  input: { referenceRetailMinor: number; allowedBps: number | null; retailSource?: string | null; notes?: string | null; currency?: string },
): void {
  validate(input);
  const existing = getPriceOverride(db, source, externalId);
  const values = {
    source,
    externalId,
    referenceRetailMinor: input.referenceRetailMinor,
    allowedBps: input.allowedBps,
    currency: input.currency ?? "USD",
    retailSource: input.retailSource?.trim() || null,
    // Notes are kept unless new ones are given (the listing form has no notes field).
    notes: input.notes !== undefined ? input.notes?.trim() || null : existing?.notes ?? null,
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

// --- Settings ---------------------------------------------------------------------------

export function updatePricingSettings(db: AppDb, patch: Partial<PricingSettings>): PricingSettings {
  const next = { ...loadPricingSettings(db), ...patch };
  if (!Number.isInteger(next.defaultAllowedBps) || next.defaultAllowedBps < 100 || next.defaultAllowedBps > 10000) {
    throw new ValidationError("Your default % must be between 1% and 100%.");
  }
  saveSetting(db, "pricing", next);
  recomputePricing(db);
  return next;
}
