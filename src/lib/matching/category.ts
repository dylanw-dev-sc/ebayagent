import type { CategoryConfig, ConditionConfig } from "../domain/types";
import { containsPhrase, normalizePhrase } from "../text";

export interface CategoryResolution {
  categoryId: number | null;
  source: "ebay_category" | "search_query" | "title" | "none";
  note: string;
}

/**
 * Resolve which of the user's categories a listing belongs to.
 * Priority: eBay category IDs → the category of the search query that found it → title keywords.
 */
export function resolveCategory(
  input: { ebayCategoryIds: string[]; queryCategoryIds: number[]; title: string },
  categories: CategoryConfig[],
): CategoryResolution {
  for (const cat of categories) {
    if (cat.ebayCategoryIds.some((id) => input.ebayCategoryIds.includes(id))) {
      return { categoryId: cat.id, source: "ebay_category", note: `eBay category maps to ${cat.name}` };
    }
  }
  const fromQuery = input.queryCategoryIds.filter((id) => categories.some((c) => c.id === id));
  if (fromQuery.length === 1) {
    const cat = categories.find((c) => c.id === fromQuery[0])!;
    return { categoryId: cat.id, source: "search_query", note: `Found by a ${cat.name} search` };
  }
  const title = normalizePhrase(input.title);
  let best: { cat: CategoryConfig; len: number } | null = null;
  for (const cat of categories) {
    for (const kw of cat.titleKeywords) {
      const k = normalizePhrase(kw);
      if (k && containsPhrase(title, k) && (!best || k.length > best.len)) best = { cat, len: k.length };
    }
  }
  if (best) return { categoryId: best.cat.id, source: "title", note: `Category inferred from title keywords (${best.cat.name})` };
  return { categoryId: null, source: "none", note: "Couldn't determine the clothing category" };
}

export interface ConditionResolution {
  key: string | null;
  label: string | null;
}

export function resolveCondition(input: { conditionId: string | null; conditionText: string | null }, conditions: ConditionConfig[]): ConditionResolution {
  if (input.conditionId) {
    const byId = conditions.find((c) => c.ebayConditionIds.includes(input.conditionId!));
    if (byId) return { key: byId.key, label: byId.name };
  }
  const text = normalizePhrase(input.conditionText);
  if (text) {
    // Prefer the most specific (longest) term that matches.
    let best: { c: ConditionConfig; len: number } | null = null;
    for (const c of conditions) {
      for (const term of [c.name, ...c.matchTerms]) {
        const t = normalizePhrase(term);
        if (t && (text === t || containsPhrase(text, t)) && (!best || t.length > best.len)) best = { c, len: t.length };
      }
    }
    if (best) return { key: best.c.key, label: best.c.name };
    return { key: null, label: input.conditionText };
  }
  return { key: null, label: null };
}
