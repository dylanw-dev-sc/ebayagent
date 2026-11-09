import { createHash } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type {
  BrandConfig,
  BrandGroupConfig,
  CategoryConfig,
  ConditionConfig,
  MaterialConfig,
  ProfileForEvaluation,
} from "../../lib/domain/types";
import { buildEngineContext, type EngineContext } from "../../lib/matching/engine";
import { resolveProfile, type PersonalDefaults, type ProfileOverrides, type ResolvedProfile } from "../../lib/profiles/resolve";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import { seedDefaults, seedScanSettings, type DefaultsSetting, type ScanSettings } from "../db/seed-data";

/** Loads stored preferences into the shapes the pure engines consume. */

export function loadGroups(db: AppDb): Array<BrandGroupConfig & { description: string | null; sortOrder: number }> {
  return db.select().from(s.brandGroups).orderBy(asc(s.brandGroups.sortOrder), asc(s.brandGroups.name)).all();
}

export function loadBrands(db: AppDb): Array<BrandConfig & { notes: string | null }> {
  const rows = db.select().from(s.brands).orderBy(sql`${s.brands.name} collate nocase`).all();
  const aliases = db.select().from(s.brandAliases).orderBy(asc(s.brandAliases.alias)).all();
  const members = db.select().from(s.brandGroupMembers).all();
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    searchQuery: b.searchQuery,
    enabled: b.enabled,
    aliases: aliases.filter((a) => a.brandId === b.id).map((a) => a.alias),
    excludePhrases: b.excludePhrases,
    groupIds: members.filter((m) => m.brandId === b.id).map((m) => m.groupId),
    notes: b.notes,
  }));
}

export function loadCategories(db: AppDb): Array<CategoryConfig & { description: string | null; sortOrder: number }> {
  return db
    .select()
    .from(s.categories)
    .orderBy(asc(s.categories.sortOrder), asc(s.categories.name))
    .all()
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      noun: c.noun,
      description: c.description,
      enabled: c.enabled,
      sizeSystem: c.sizeSystem,
      defaultSizes: { accepted: c.acceptedSizes, review: c.reviewSizes, neck: c.neckSizes, sleeve: c.sleeveLengths },
      ebayCategoryIds: c.ebayCategoryIds,
      titleKeywords: c.titleKeywords,
      excludeKeywords: c.excludeKeywords,
      measurements: c.measurementRanges ?? {},
      sortOrder: c.sortOrder,
    }));
}

export function loadMaterials(db: AppDb): Array<MaterialConfig & { id: number; notes: string | null; sortOrder: number }> {
  return db
    .select()
    .from(s.materials)
    .orderBy(asc(s.materials.sortOrder), asc(s.materials.name))
    .all()
    .map((m) => ({
      id: m.id,
      key: m.key,
      name: m.name,
      kind: m.kind,
      priority: m.priority,
      keywords: m.keywords,
      components: m.components,
      heavyThresholdPct: m.heavyThresholdPct,
      notes: m.notes,
      sortOrder: m.sortOrder,
    }));
}

export function loadConditions(db: AppDb): Array<ConditionConfig & { id: number; sortOrder: number }> {
  return db
    .select()
    .from(s.conditions)
    .orderBy(asc(s.conditions.sortOrder))
    .all()
    .map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      ebayConditionIds: c.ebayConditionIds,
      matchTerms: c.matchTerms,
      accepted: c.accepted,
      sortOrder: c.sortOrder,
    }));
}

function getSetting<T>(db: AppDb, key: string, fallback: T): T {
  const row = db.select().from(s.settings).where(eq(s.settings.key, key)).get();
  if (!row) return fallback;
  return { ...fallback, ...(row.value as object) } as T;
}

export function loadDefaultsSetting(db: AppDb): DefaultsSetting {
  return getSetting(db, "defaults", seedDefaults);
}

export function loadScanSettings(db: AppDb): ScanSettings {
  return getSetting(db, "scan", seedScanSettings);
}

export function saveSetting(db: AppDb, key: "defaults" | "scan", value: object): void {
  db.insert(s.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: s.settings.key, set: { value, updatedAt: new Date() } })
    .run();
}

export function loadPersonalDefaults(db: AppDb): PersonalDefaults {
  const d = loadDefaultsSetting(db);
  return {
    conditionKeys: loadConditions(db)
      .filter((c) => c.accepted)
      .map((c) => c.key),
    excludedMaterialKeys: loadMaterials(db)
      .filter((m) => m.priority === "exclude")
      .map((m) => m.key),
    unknownMaterialPolicy: d.unknownMaterialPolicy,
    excludeKeywords: d.excludeKeywords,
    priceMinMinor: d.priceMinMinor,
    priceMaxMinor: d.priceMaxMinor,
  };
}

export interface LoadedProfile {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  sortOrder: number;
  overrides: ProfileOverrides;
  resolved: ResolvedProfile;
  updatedAt: Date;
}

export function loadProfiles(
  db: AppDb,
  pre?: { brands?: BrandConfig[]; categories?: CategoryConfig[]; defaults?: PersonalDefaults },
): LoadedProfile[] {
  const brands = pre?.brands ?? loadBrands(db);
  const categories = pre?.categories ?? loadCategories(db);
  const defaults = pre?.defaults ?? loadPersonalDefaults(db);
  return db
    .select()
    .from(s.searchProfiles)
    .orderBy(asc(s.searchProfiles.sortOrder), asc(s.searchProfiles.id))
    .all()
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      enabled: p.enabled,
      sortOrder: p.sortOrder,
      overrides: p.overrides ?? {},
      resolved: resolveProfile({ overrides: p.overrides ?? {}, defaults, brands, categories }),
      updatedAt: p.updatedAt,
    }));
}

export interface LoadedContext {
  engine: EngineContext;
  profiles: LoadedProfile[];
  groups: ReturnType<typeof loadGroups>;
  rulesHash: string;
}

/** Everything the matching engine needs, plus a hash that changes whenever any rule changes. */
export function loadEngineContext(db: AppDb): LoadedContext {
  const brands = loadBrands(db);
  const categories = loadCategories(db);
  const materials = loadMaterials(db);
  const conditions = loadConditions(db);
  const defaults = loadPersonalDefaults(db);
  const profiles = loadProfiles(db, { brands, categories, defaults });
  const groups = loadGroups(db);
  const evalProfiles: ProfileForEvaluation[] = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    enabled: p.enabled,
    settings: p.resolved.settings,
  }));
  const d = loadDefaultsSetting(db);
  const redFlags = { phrases: d.redFlagPhrases, policy: d.redFlagPolicy };
  const engine = buildEngineContext({ brands, categories, materials, conditions, profiles: evalProfiles, redFlags });
  const rulesHash = createHash("sha1")
    .update(
      JSON.stringify({
        v: 1,
        brands: brands.map(({ notes, ...b }) => b),
        categories,
        materials: materials.map(({ notes, sortOrder, ...m }) => m),
        conditions,
        profiles: evalProfiles,
        redFlags,
      }),
    )
    .digest("hex");
  return { engine, profiles, groups, rulesHash };
}
