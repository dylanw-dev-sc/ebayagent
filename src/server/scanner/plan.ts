import type { ProviderQuery } from "../../lib/providers/types";
import type { LoadedContext } from "../services/context";
import type { ScanSettings } from "../db/seed-data";

export interface PlannedQuery extends ProviderQuery {
  profileIds: number[];
}

/**
 * Turn enabled search profiles into provider queries. eBay's search accepts
 * one category ID per request, so each (brand × eBay category) pair is one
 * query. Queries shared by several profiles are generated once.
 */
export function planQueries(ctx: LoadedContext, settings: ScanSettings): PlannedQuery[] {
  const byKey = new Map<string, PlannedQuery>();
  const { engine } = ctx;
  const allConditionKeys = engine.conditions.map((c) => c.key);

  for (const profile of ctx.profiles) {
    if (!profile.enabled) continue;
    const st = profile.resolved.settings;
    // Only filter conditions at the API when the profile rejects some of them.
    const restrictsConditions = allConditionKeys.some((k) => !st.conditionKeys.includes(k));
    const conditionIds = restrictsConditions
      ? engine.conditions.filter((c) => st.conditionKeys.includes(c.key)).flatMap((c) => c.ebayConditionIds)
      : [];
    for (const brandId of st.brandIds) {
      const brand = engine.brands.find((b) => b.id === brandId);
      if (!brand || !brand.enabled) continue;
      for (const categoryId of st.categoryIds) {
        const category = engine.categories.find((c) => c.id === categoryId);
        if (!category || !category.enabled) continue;
        const ebayIds = category.ebayCategoryIds.length ? category.ebayCategoryIds : [null];
        for (const ebayCategoryId of ebayIds) {
          const key = `b${brand.id}:c${category.id}:e${ebayCategoryId ?? "any"}`;
          const existing = byKey.get(key);
          if (existing) {
            if (!existing.profileIds.includes(profile.id)) existing.profileIds.push(profile.id);
            // Union of condition filters; an unrestricted profile removes the filter entirely.
            existing.conditionIds =
              existing.conditionIds.length === 0 || conditionIds.length === 0
                ? []
                : Array.from(new Set([...existing.conditionIds, ...conditionIds]));
            continue;
          }
          byKey.set(key, {
            key,
            description: `${brand.name} · ${category.name}${ebayCategoryId ? ` · eBay cat ${ebayCategoryId}` : ""}`,
            keywords: brand.searchQuery?.trim() || brand.name,
            ebayCategoryId,
            appCategoryId: category.id,
            brandId: brand.id,
            conditionIds,
            includeAuctions: settings.includeAuctions,
            deliveryCountry: settings.deliveryCountry || null,
            profileIds: [profile.id],
          });
        }
      }
    }
  }
  return Array.from(byKey.values());
}
