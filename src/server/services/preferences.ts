import { and, eq, ne } from "drizzle-orm";
import type { MaterialPriority, SizeSystem } from "../../lib/domain/types";
import { parseSizeText } from "../../lib/matching/size";
import { normalizePhrase, uniq } from "../../lib/text";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import { defaultSearchQuery } from "../db/seed";
import type { DefaultsSetting, ScanSettings } from "../db/seed-data";
import { loadDefaultsSetting, loadScanSettings, saveSetting } from "./context";
import { refreshDerivedData } from "./evaluation";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const clean = (list: string[] | undefined) => uniq((list ?? []).map((x) => x.trim()).filter(Boolean));

// --- Brands ---------------------------------------------------------------------------

function assertPhrasesFree(db: AppDb, phrases: string[], ownBrandId: number | null): void {
  const brands = db.select().from(s.brands).all();
  const aliases = db.select().from(s.brandAliases).all();
  for (const p of phrases) {
    const n = normalizePhrase(p);
    if (!n) throw new ValidationError(`“${p}” has no letters or numbers.`);
    const brandClash = brands.find((b) => b.id !== ownBrandId && b.normalizedName === n);
    if (brandClash) throw new ValidationError(`“${p}” is already the name of ${brandClash.name}.`);
    const aliasClash = aliases.find((a) => a.brandId !== ownBrandId && a.normalizedAlias === n);
    if (aliasClash) {
      const owner = brands.find((b) => b.id === aliasClash.brandId);
      throw new ValidationError(`“${p}” is already an alias of ${owner?.name ?? "another brand"}.`);
    }
  }
}

export interface BrandInput {
  name: string;
  searchQuery?: string;
  aliases?: string[];
  groupIds?: number[];
  excludePhrases?: string[];
  enabled?: boolean;
  notes?: string | null;
}

export function createBrand(db: AppDb, input: BrandInput): number {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Brand name is required.");
  const aliases = clean(input.aliases).filter((a) => normalizePhrase(a) !== normalizePhrase(name));
  assertPhrasesFree(db, [name, ...aliases], null);
  const id = db.transaction((tx) => {
    const row = tx
      .insert(s.brands)
      .values({
        name,
        normalizedName: normalizePhrase(name),
        searchQuery: input.searchQuery?.trim() || defaultSearchQuery(name),
        enabled: input.enabled ?? true,
        excludePhrases: clean(input.excludePhrases),
        notes: input.notes ?? null,
      })
      .returning({ id: s.brands.id })
      .get();
    for (const alias of aliases) tx.insert(s.brandAliases).values({ brandId: row.id, alias, normalizedAlias: normalizePhrase(alias) }).run();
    for (const groupId of uniq(input.groupIds ?? [])) tx.insert(s.brandGroupMembers).values({ brandId: row.id, groupId }).onConflictDoNothing().run();
    return row.id;
  });
  refreshDerivedData(db);
  return id;
}

export function updateBrand(db: AppDb, id: number, patch: Partial<BrandInput>): void {
  const existing = db.select().from(s.brands).where(eq(s.brands.id, id)).get();
  if (!existing) throw new ValidationError("Brand not found.");
  db.transaction((tx) => {
    const set: Partial<typeof s.brands.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new ValidationError("Brand name is required.");
      assertPhrasesFree(db, [name], id);
      set.name = name;
      set.normalizedName = normalizePhrase(name);
    }
    if (patch.searchQuery !== undefined) set.searchQuery = patch.searchQuery.trim() || defaultSearchQuery(set.name ?? existing.name);
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (patch.excludePhrases !== undefined) set.excludePhrases = clean(patch.excludePhrases);
    if (patch.notes !== undefined) set.notes = patch.notes;
    tx.update(s.brands).set(set).where(eq(s.brands.id, id)).run();
    if (patch.aliases !== undefined) {
      const brandName = set.name ?? existing.name;
      const aliases = clean(patch.aliases).filter((a) => normalizePhrase(a) !== normalizePhrase(brandName));
      assertPhrasesFree(db, aliases, id);
      tx.delete(s.brandAliases).where(eq(s.brandAliases.brandId, id)).run();
      for (const alias of aliases) tx.insert(s.brandAliases).values({ brandId: id, alias, normalizedAlias: normalizePhrase(alias) }).run();
    }
    if (patch.groupIds !== undefined) {
      tx.delete(s.brandGroupMembers).where(eq(s.brandGroupMembers.brandId, id)).run();
      for (const groupId of uniq(patch.groupIds)) tx.insert(s.brandGroupMembers).values({ brandId: id, groupId }).onConflictDoNothing().run();
    }
  });
  refreshDerivedData(db);
}

export function deleteBrand(db: AppDb, id: number): void {
  db.delete(s.brands).where(eq(s.brands.id, id)).run();
  refreshDerivedData(db);
}

// --- Brand groups ------------------------------------------------------------------------

export function createGroup(db: AppDb, input: { name: string; description?: string | null }): number {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Group name is required.");
  if (db.select().from(s.brandGroups).where(eq(s.brandGroups.name, name)).get()) throw new ValidationError(`A group named “${name}” already exists.`);
  const max = db.select().from(s.brandGroups).all().reduce((m, g) => Math.max(m, g.sortOrder), 0);
  const id = db.insert(s.brandGroups).values({ name, description: input.description ?? null, sortOrder: max + 1 }).returning({ id: s.brandGroups.id }).get().id;
  refreshDerivedData(db);
  return id;
}

export function updateGroup(db: AppDb, id: number, patch: { name?: string; description?: string | null }): void {
  const set: Partial<typeof s.brandGroups.$inferInsert> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new ValidationError("Group name is required.");
    const clash = db.select().from(s.brandGroups).where(and(eq(s.brandGroups.name, name), ne(s.brandGroups.id, id))).get();
    if (clash) throw new ValidationError(`A group named “${name}” already exists.`);
    set.name = name;
  }
  if (patch.description !== undefined) set.description = patch.description;
  if (Object.keys(set).length) db.update(s.brandGroups).set(set).where(eq(s.brandGroups.id, id)).run();
  refreshDerivedData(db);
}

export function deleteGroup(db: AppDb, id: number): void {
  db.delete(s.brandGroups).where(eq(s.brandGroups.id, id)).run();
  refreshDerivedData(db);
}

// --- Categories & sizes -----------------------------------------------------------------------

export interface CategoryInput {
  name: string;
  noun?: string;
  description?: string | null;
  enabled?: boolean;
  sizeSystem?: SizeSystem;
  acceptedSizes?: string[];
  reviewSizes?: string[];
  neckSizes?: string[];
  sleeveLengths?: string[];
  ebayCategoryIds?: string[];
  titleKeywords?: string[];
  excludeKeywords?: string[];
}

function validateSizes(list: string[], label: string): string[] {
  const cleaned = clean(list);
  for (const v of cleaned) {
    const parsed = parseSizeText(v);
    if (parsed.length === 0 || parsed.every((p) => p.kind === "other")) throw new ValidationError(`${label}: “${v}” isn't a recognized size (try L, XL, 44R, 16.5/35).`);
  }
  return cleaned;
}

function validateNumbers(list: string[], label: string): string[] {
  const cleaned = clean(list);
  for (const v of cleaned) if (!/^\d{2}(\.5)?(\s*[-/]\s*\d{2})?$/.test(v)) throw new ValidationError(`${label}: “${v}” should look like 16.5 or 34.`);
  return cleaned;
}

function validateEbayIds(db: AppDb, ids: string[], ownCategoryId: number | null): string[] {
  const cleaned = clean(ids);
  for (const id of cleaned) if (!/^\d+$/.test(id)) throw new ValidationError(`eBay category IDs are numbers (got “${id}”).`);
  const others = db.select().from(s.categories).all().filter((c) => c.id !== ownCategoryId);
  for (const id of cleaned) {
    const clash = others.find((c) => c.ebayCategoryIds.includes(id));
    if (clash) throw new ValidationError(`eBay category ${id} is already mapped to ${clash.name}.`);
  }
  return cleaned;
}

export function createCategory(db: AppDb, input: CategoryInput): number {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Category name is required.");
  const slugBase = normalizePhrase(name).replace(/\s+/g, "-") || "category";
  let slug = slugBase;
  for (let i = 2; db.select().from(s.categories).where(eq(s.categories.slug, slug)).get(); i++) slug = `${slugBase}-${i}`;
  const max = db.select().from(s.categories).all().reduce((m, c) => Math.max(m, c.sortOrder), 0);
  const id = db
    .insert(s.categories)
    .values({
      slug,
      name,
      noun: input.noun?.trim() || name.toLowerCase().replace(/s$/, ""),
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      sizeSystem: input.sizeSystem ?? "alpha",
      acceptedSizes: validateSizes(input.acceptedSizes ?? [], "Accepted sizes"),
      reviewSizes: validateSizes(input.reviewSizes ?? [], "Sizes to review"),
      neckSizes: validateNumbers(input.neckSizes ?? [], "Neck sizes"),
      sleeveLengths: validateNumbers(input.sleeveLengths ?? [], "Sleeve lengths"),
      ebayCategoryIds: validateEbayIds(db, input.ebayCategoryIds ?? [], null),
      titleKeywords: clean(input.titleKeywords),
      excludeKeywords: clean(input.excludeKeywords),
      sortOrder: max + 1,
    })
    .returning({ id: s.categories.id })
    .get().id;
  refreshDerivedData(db);
  return id;
}

export function updateCategory(db: AppDb, id: number, patch: Partial<CategoryInput>): void {
  const set: Partial<typeof s.categories.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new ValidationError("Category name is required.");
    set.name = patch.name.trim();
  }
  if (patch.noun !== undefined) set.noun = patch.noun.trim() || "item";
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.sizeSystem !== undefined) set.sizeSystem = patch.sizeSystem;
  if (patch.acceptedSizes !== undefined) set.acceptedSizes = validateSizes(patch.acceptedSizes, "Accepted sizes");
  if (patch.reviewSizes !== undefined) set.reviewSizes = validateSizes(patch.reviewSizes, "Sizes to review");
  if (patch.neckSizes !== undefined) set.neckSizes = validateNumbers(patch.neckSizes, "Neck sizes");
  if (patch.sleeveLengths !== undefined) set.sleeveLengths = validateNumbers(patch.sleeveLengths, "Sleeve lengths");
  if (patch.ebayCategoryIds !== undefined) set.ebayCategoryIds = validateEbayIds(db, patch.ebayCategoryIds, id);
  if (patch.titleKeywords !== undefined) set.titleKeywords = clean(patch.titleKeywords);
  if (patch.excludeKeywords !== undefined) set.excludeKeywords = clean(patch.excludeKeywords);
  db.update(s.categories).set(set).where(eq(s.categories.id, id)).run();
  refreshDerivedData(db);
}

export function deleteCategory(db: AppDb, id: number): void {
  db.delete(s.categories).where(eq(s.categories.id, id)).run();
  refreshDerivedData(db);
}

// --- Materials --------------------------------------------------------------------------

const PRIORITIES: MaterialPriority[] = ["very_high", "high", "neutral", "avoid", "exclude"];

export interface MaterialInput {
  name: string;
  kind?: "fiber" | "blend";
  priority?: MaterialPriority;
  keywords?: string[];
  components?: string[];
  heavyThresholdPct?: number | null;
  notes?: string | null;
}

export function createMaterial(db: AppDb, input: MaterialInput): number {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Material name is required.");
  const key = normalizePhrase(name).replace(/\s+/g, "_");
  if (db.select().from(s.materials).where(eq(s.materials.key, key)).get()) throw new ValidationError(`A material named “${name}” already exists.`);
  const kind = input.kind ?? "fiber";
  const keywords = clean(input.keywords?.length ? input.keywords : [name]);
  const components = clean(input.components);
  if (kind === "blend" && components.length < 2) throw new ValidationError("A blend needs at least two component materials.");
  const priority = input.priority ?? "neutral";
  if (!PRIORITIES.includes(priority)) throw new ValidationError("Unknown priority.");
  const max = db.select().from(s.materials).all().reduce((m, x) => Math.max(m, x.sortOrder), 0);
  const id = db
    .insert(s.materials)
    .values({ key, name, kind, priority, keywords: kind === "fiber" ? keywords : [], components, heavyThresholdPct: input.heavyThresholdPct ?? null, notes: input.notes ?? null, sortOrder: max + 1 })
    .returning({ id: s.materials.id })
    .get().id;
  refreshDerivedData(db);
  return id;
}

export function updateMaterial(db: AppDb, id: number, patch: Partial<MaterialInput>): void {
  const set: Partial<typeof s.materials.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name.trim() || "Material";
  if (patch.priority !== undefined) {
    if (!PRIORITIES.includes(patch.priority)) throw new ValidationError("Unknown priority.");
    set.priority = patch.priority;
  }
  if (patch.keywords !== undefined) set.keywords = clean(patch.keywords);
  if (patch.components !== undefined) set.components = clean(patch.components);
  if (patch.heavyThresholdPct !== undefined) {
    const v = patch.heavyThresholdPct;
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 100)) throw new ValidationError("Threshold must be a whole percentage between 1 and 100.");
    set.heavyThresholdPct = v;
  }
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (Object.keys(set).length) db.update(s.materials).set(set).where(eq(s.materials.id, id)).run();
  refreshDerivedData(db);
}

export function deleteMaterial(db: AppDb, id: number): void {
  db.delete(s.materials).where(eq(s.materials.id, id)).run();
  refreshDerivedData(db);
}

// --- Conditions -------------------------------------------------------------------------------

export function updateCondition(db: AppDb, id: number, patch: { accepted?: boolean; name?: string; matchTerms?: string[]; ebayConditionIds?: string[] }): void {
  const set: Partial<typeof s.conditions.$inferInsert> = {};
  if (patch.accepted !== undefined) set.accepted = patch.accepted;
  if (patch.name !== undefined) set.name = patch.name.trim() || "Condition";
  if (patch.matchTerms !== undefined) set.matchTerms = clean(patch.matchTerms);
  if (patch.ebayConditionIds !== undefined) {
    const ids = clean(patch.ebayConditionIds);
    for (const v of ids) if (!/^\d+$/.test(v)) throw new ValidationError(`eBay condition IDs are numbers (got “${v}”).`);
    set.ebayConditionIds = ids;
  }
  if (Object.keys(set).length) db.update(s.conditions).set(set).where(eq(s.conditions.id, id)).run();
  refreshDerivedData(db);
}

export function createCondition(db: AppDb, input: { name: string; ebayConditionIds?: string[]; matchTerms?: string[]; accepted?: boolean }): number {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Condition name is required.");
  const key = normalizePhrase(name).replace(/\s+/g, "_");
  if (db.select().from(s.conditions).where(eq(s.conditions.key, key)).get()) throw new ValidationError(`A condition named “${name}” already exists.`);
  const max = db.select().from(s.conditions).all().reduce((m, c) => Math.max(m, c.sortOrder), 0);
  const id = db
    .insert(s.conditions)
    .values({ key, name, ebayConditionIds: clean(input.ebayConditionIds), matchTerms: clean(input.matchTerms), accepted: input.accepted ?? true, sortOrder: max + 1 })
    .returning({ id: s.conditions.id })
    .get().id;
  refreshDerivedData(db);
  return id;
}

// --- Defaults & scan settings -------------------------------------------------------------------------

export function updateDefaults(db: AppDb, patch: Partial<DefaultsSetting>): DefaultsSetting {
  const next = { ...loadDefaultsSetting(db), ...patch };
  if (patch.excludeKeywords) next.excludeKeywords = clean(patch.excludeKeywords);
  if (next.priceMinMinor !== null && next.priceMaxMinor !== null && next.priceMinMinor > next.priceMaxMinor) {
    throw new ValidationError("Minimum price can't be above the maximum price.");
  }
  saveSetting(db, "defaults", next);
  refreshDerivedData(db);
  return next;
}

export function updateScanSettings(db: AppDb, patch: Partial<ScanSettings>): ScanSettings {
  const next = { ...loadScanSettings(db), ...patch };
  const intIn = (v: number, lo: number, hi: number, label: string) => {
    if (!Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(`${label} must be a whole number between ${lo} and ${hi}.`);
  };
  intIn(next.pageSize, 1, 200, "Page size");
  intIn(next.maxPagesPerQuery, 1, 50, "Pages per query");
  intIn(next.lookbackHours, 0, 168, "Look-back hours");
  intIn(next.detailFetchLimit, 0, 1000, "Detail fetches per scan");
  intIn(next.dailyCallBudget, 1, 1_000_000, "Daily call budget");
  intIn(next.requestIntervalMs, 0, 10_000, "Request interval");
  intIn(next.retentionDays, 1, 30, "Retention days");
  intIn(next.staleAfterHours, 1, 24, "Stale-after hours");
  if (next.deliveryCountry && !/^[A-Z]{2}$/.test(next.deliveryCountry)) throw new ValidationError("Delivery country must be a 2-letter code like US.");
  saveSetting(db, "scan", next);
  return next;
}
