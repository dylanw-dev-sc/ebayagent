import type {
  BrandConfig,
  CategoryConfig,
  EffectiveProfileSettings,
  SizePrefs,
  UnknownMaterialPolicy,
} from "../domain/types";

/**
 * Search-profile inheritance.
 *
 * A profile stores ONLY its explicit overrides. A key that is absent means
 * "inherit the personal default"; a key that is present (even with an empty
 * list or null) is an explicit override. Effective settings are resolved at
 * read time, so changing a personal default immediately flows to every
 * profile that inherits it, while explicit overrides are never touched.
 */

export interface BrandScope {
  groupIds: number[];
  brandIds: number[];
}

export interface ProfileOverrides {
  brandScope?: BrandScope;
  categoryIds?: number[];
  /** Keyed by category id (string keys because this is stored as JSON). */
  sizes?: Record<string, SizePrefs>;
  conditionKeys?: string[];
  requiredMaterialKeys?: string[];
  excludedMaterialKeys?: string[];
  unknownMaterialPolicy?: UnknownMaterialPolicy;
  excludeKeywords?: string[];
  priceMinMinor?: number | null;
  priceMaxMinor?: number | null;
}

export type OverridableField = Exclude<keyof ProfileOverrides, "sizes">;
export const OVERRIDABLE_FIELDS: OverridableField[] = [
  "brandScope",
  "categoryIds",
  "conditionKeys",
  "requiredMaterialKeys",
  "excludedMaterialKeys",
  "unknownMaterialPolicy",
  "excludeKeywords",
  "priceMinMinor",
  "priceMaxMinor",
];

export interface PersonalDefaults {
  conditionKeys: string[];
  excludedMaterialKeys: string[];
  unknownMaterialPolicy: UnknownMaterialPolicy;
  excludeKeywords: string[];
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
}

export type Provenance = "inherited" | "override";

export interface ResolvedProfile {
  settings: EffectiveProfileSettings;
  provenance: Record<OverridableField, Provenance>;
  sizeProvenance: Record<number, Provenance>;
}

export function hasOverride(overrides: ProfileOverrides, field: keyof ProfileOverrides): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, field) && overrides[field] !== undefined;
}

export function resolveProfile(input: {
  overrides: ProfileOverrides;
  defaults: PersonalDefaults;
  brands: BrandConfig[];
  categories: CategoryConfig[];
}): ResolvedProfile {
  const { overrides: o, defaults: d } = input;
  const enabledBrands = input.brands.filter((b) => b.enabled);
  const enabledCategories = input.categories.filter((c) => c.enabled);

  const provenance = {} as Record<OverridableField, Provenance>;
  for (const f of OVERRIDABLE_FIELDS) provenance[f] = hasOverride(o, f) ? "override" : "inherited";

  let brandIds: number[];
  if (o.brandScope) {
    const groups = new Set(o.brandScope.groupIds);
    const explicit = new Set(o.brandScope.brandIds);
    brandIds = enabledBrands.filter((b) => explicit.has(b.id) || b.groupIds.some((g) => groups.has(g))).map((b) => b.id);
  } else {
    brandIds = enabledBrands.map((b) => b.id);
  }

  const categoryIds = o.categoryIds
    ? enabledCategories.filter((c) => o.categoryIds!.includes(c.id)).map((c) => c.id)
    : enabledCategories.map((c) => c.id);

  const sizes: Record<number, SizePrefs> = {};
  const sizeProvenance: Record<number, Provenance> = {};
  for (const c of input.categories) {
    const ov = o.sizes?.[String(c.id)];
    sizes[c.id] = ov ?? c.defaultSizes;
    sizeProvenance[c.id] = ov ? "override" : "inherited";
  }

  const pick = <K extends keyof PersonalDefaults & keyof ProfileOverrides>(k: K): PersonalDefaults[K] =>
    (hasOverride(o, k) ? (o[k] as PersonalDefaults[K]) : d[k]);

  return {
    settings: {
      brandIds,
      categoryIds,
      sizes,
      conditionKeys: pick("conditionKeys"),
      requiredMaterialKeys: o.requiredMaterialKeys ?? [],
      excludedMaterialKeys: pick("excludedMaterialKeys"),
      unknownMaterialPolicy: pick("unknownMaterialPolicy"),
      excludeKeywords: pick("excludeKeywords"),
      priceMinMinor: pick("priceMinMinor"),
      priceMaxMinor: pick("priceMaxMinor"),
    },
    provenance,
    sizeProvenance,
  };
}

/** Return a copy of overrides with one field reset to "inherit". */
export function resetOverride(overrides: ProfileOverrides, field: keyof ProfileOverrides, categoryId?: number): ProfileOverrides {
  const next: ProfileOverrides = { ...overrides };
  if (field === "sizes" && categoryId !== undefined) {
    const sizes = { ...(next.sizes ?? {}) };
    delete sizes[String(categoryId)];
    if (Object.keys(sizes).length) next.sizes = sizes;
    else delete next.sizes;
    return next;
  }
  delete next[field];
  return next;
}
