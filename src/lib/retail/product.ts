import type { CategoryConfig } from "../domain/types";
import { containsPhrase, normalizePhrase } from "../text";

/**
 * What kind of item a listing is, for looking up its typical new price:
 * brand × category × garment word × main material.
 */

/** The longest of the category's own title keywords found in the title (e.g. "cardigan", "sport coat"), else the category noun. */
export function garmentTypeFor(title: string, category: Pick<CategoryConfig, "titleKeywords" | "noun">): string {
  const t = normalizePhrase(title);
  let best = "";
  for (const kw of category.titleKeywords) {
    const k = normalizePhrase(kw);
    if (k && containsPhrase(t, k) && k.length > best.length) best = k;
  }
  return best || normalizePhrase(category.noun);
}

export function productKeyOf(p: { brandId: number; categoryId: number; garmentType: string; materialKey: string | null }): string {
  return `${p.brandId}|${p.categoryId}|${p.garmentType}|${p.materialKey ?? "*"}`;
}

/**
 * The search query, built ONLY from your own words — brand search name, material
 * name and garment word — never from the eBay listing's text, so no eBay content
 * is sent to the search provider.
 */
export function buildRetailQuery(p: { brandQuery: string; garmentType: string; materialName: string | null }): string {
  return [p.brandQuery, "men's", p.materialName?.toLowerCase() ?? null, p.garmentType]
    .filter((x): x is string => !!x && x.trim() !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
