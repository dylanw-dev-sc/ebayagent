import { eq } from "drizzle-orm";
import type { ListingFacts, Reason } from "../../lib/matching/engine";
import { parseSizeText, sizeKey } from "../../lib/matching/size";
import { normalizePhrase, tokenize, uniq } from "../../lib/text";
import type { AppDb } from "../db/client";
import * as s from "../db/schema";
import { loadBrands, loadCategories } from "./context";
import { updateBrand, updateCategory, ValidationError } from "./preferences";

/**
 * One-click corrections: when a decision looks wrong, offer the rule change
 * that would fix it (brand alias, never-match phrase, size lists, category
 * keyword). Each fix edits Preferences and re-evaluates stored listings.
 */

export type Suggestion =
  | { kind: "brand_alias"; alias: string; brandId: number | null }
  | { kind: "brand_exclude"; brandId: number; brandName: string; phrase: string }
  | { kind: "size_accept"; categoryId: number; categoryName: string; size: string; list: "accepted" | "review" }
  | { kind: "size_remove"; categoryId: number; categoryName: string; size: string }
  | { kind: "category_exclude"; categoryId: number; categoryName: string; keyword: string };

const NON_BRANDS = new Set(["unbranded", "unknown", "does not apply", "na", "n a", "none", "no brand", "generic"]);

/** Words that usually mean "this isn't the kind of garment you meant". */
const OTHER_GARMENTS = [
  "trousers", "pants", "chinos", "jeans", "shorts", "scarf", "tie", "bow tie", "pocket square", "belt", "shoes", "loafers", "sneakers", "boots",
  "sweater", "cardigan", "hoodie", "sweatshirt", "hat", "cap", "beanie", "socks", "bag", "wallet", "gloves", "swim", "pajamas", "robe",
];

function guessBrandForAlias(alias: string, brands: Array<{ id: number; name: string; aliases: string[] }>): number | null {
  const words = new Set(tokenize(normalizePhrase(alias)).filter((w) => w.length > 2));
  let best: { id: number; score: number } | null = null;
  for (const b of brands) {
    const tokens = uniq([b.name, ...b.aliases].flatMap((n) => tokenize(normalizePhrase(n))));
    const score = tokens.filter((t) => words.has(t)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: b.id, score };
  }
  return best?.id ?? null;
}

/** The brand mention in the title plus the next word, e.g. "Loro Piana wool". */
function phraseAround(title: string, matchedPhrase: string | null, fallback: string): string {
  const words = title.split(/\s+/);
  const norm = words.map((w) => normalizePhrase(w));
  const target = tokenize(normalizePhrase(matchedPhrase ?? ""));
  if (target.length) {
    for (let i = 0; i + target.length <= norm.length; i++) {
      if (target.every((t, j) => norm[i + j] === t)) {
        const end = Math.min(words.length, i + target.length + 1);
        return words.slice(i, end).join(" ").replace(/[,.;:]+$/, "");
      }
    }
  }
  return fallback;
}

export function suggestCorrections(input: {
  title: string;
  brandAspect: string | null;
  facts: ListingFacts;
  /** The profile whose decision is shown (only its reasons are used). */
  bestProfile: { reasons: Reason[] } | undefined;
  brands: Array<{ id: number; name: string; aliases: string[] }>;
  categories: Array<{ id: number; name: string; acceptedSizes: string[]; reviewSizes: string[]; excludeKeywords: string[] }>;
}): Suggestion[] {
  const out: Suggestion[] = [];
  const { facts } = input;
  const brandAspect = input.brandAspect && !NON_BRANDS.has(normalizePhrase(input.brandAspect)) ? input.brandAspect.trim() : null;

  // Brand
  if (facts.brand.brandId === null) {
    const alias = brandAspect ?? input.title.split(/\s+/).slice(0, 2).join(" ");
    out.push({ kind: "brand_alias", alias, brandId: guessBrandForAlias(alias, input.brands) });
  } else if (facts.brand.status !== "excluded_phrase") {
    const brand = input.brands.find((b) => b.id === facts.brand.brandId);
    if (brand) {
      const aspectDiffers = brandAspect && normalizePhrase(brandAspect) !== normalizePhrase(brand.name);
      const phrase = aspectDiffers ? brandAspect! : phraseAround(input.title, facts.brand.matchedPhrase, brand.name);
      out.push({ kind: "brand_exclude", brandId: brand.id, brandName: brand.name, phrase });
    }
  }

  // Size (your default for the category)
  const category = input.categories.find((c) => c.id === facts.category.categoryId);
  const sizeValue = facts.size.values[0];
  if (category && sizeValue) {
    const key = sizeKey(sizeValue);
    const sizeReason = input.bestProfile?.reasons.find((r) => r.dimension === "size");
    const inList = (list: string[]) => list.some((x) => parseSizeText(x).some((v) => sizeKey(v) === key));
    if (sizeReason?.effect === "pass") {
      if (inList(category.acceptedSizes)) out.push({ kind: "size_remove", categoryId: category.id, categoryName: category.name, size: key });
    } else if (sizeReason) {
      if (!inList(category.acceptedSizes)) out.push({ kind: "size_accept", categoryId: category.id, categoryName: category.name, size: key, list: "accepted" });
      if (sizeReason.effect === "exclude" && !inList(category.reviewSizes)) {
        out.push({ kind: "size_accept", categoryId: category.id, categoryName: category.name, size: key, list: "review" });
      }
    }
  }

  // Category: an obviously different garment ("scarf" found in Jackets)
  if (category) {
    const title = ` ${normalizePhrase(input.title)} `;
    const kw = OTHER_GARMENTS.find((g) => title.includes(` ${normalizePhrase(g)} `) && !category.excludeKeywords.some((k) => normalizePhrase(k) === normalizePhrase(g)));
    if (kw) out.push({ kind: "category_exclude", categoryId: category.id, categoryName: category.name, keyword: kw });
  }
  return out;
}

// --- Fixes (each edits Preferences; services re-evaluate stored listings) -----------------

export function addBrandAlias(db: AppDb, brandId: number, alias: string): string {
  const brand = loadBrands(db).find((b) => b.id === brandId);
  if (!brand) throw new ValidationError("Choose one of your brands.");
  const a = alias.trim();
  if (!a) throw new ValidationError("Enter the alias text.");
  updateBrand(db, brandId, { aliases: uniq([...brand.aliases, a]) });
  return `“${a}” now matches ${brand.name}.`;
}

export function addBrandExcludePhrase(db: AppDb, brandId: number, phrase: string): string {
  const brand = loadBrands(db).find((b) => b.id === brandId);
  if (!brand) throw new ValidationError("Brand not found.");
  const p = phrase.trim();
  if (!p) throw new ValidationError("Enter the phrase.");
  updateBrand(db, brandId, { excludePhrases: uniq([...brand.excludePhrases, p]) });
  return `${brand.name} will never match listings containing “${p}”.`;
}

export function addCategorySize(db: AppDb, categoryId: number, size: string, list: "accepted" | "review"): string {
  const cat = db.select().from(s.categories).where(eq(s.categories.id, categoryId)).get();
  if (!cat) throw new ValidationError("Category not found.");
  if (list === "accepted") updateCategory(db, categoryId, { acceptedSizes: uniq([...cat.acceptedSizes, size]) });
  else updateCategory(db, categoryId, { reviewSizes: uniq([...cat.reviewSizes, size]) });
  return `${size} ${list === "accepted" ? "is now accepted" : "now goes to Needs review"} for ${cat.name}.`;
}

export function removeCategorySize(db: AppDb, categoryId: number, size: string): string {
  const cat = db.select().from(s.categories).where(eq(s.categories.id, categoryId)).get();
  if (!cat) throw new ValidationError("Category not found.");
  const key = (x: string) => parseSizeText(x).map(sizeKey).join("/");
  const target = key(size);
  updateCategory(db, categoryId, { acceptedSizes: cat.acceptedSizes.filter((x) => key(x) !== target) });
  return `${size} is no longer accepted for ${cat.name}.`;
}

export function addCategoryExcludeKeyword(db: AppDb, categoryId: number, keyword: string): string {
  const cat = loadCategories(db).find((c) => c.id === categoryId);
  if (!cat) throw new ValidationError("Category not found.");
  const k = keyword.trim();
  if (!k) throw new ValidationError("Enter the keyword.");
  updateCategory(db, categoryId, { excludeKeywords: uniq([...cat.excludeKeywords, k]) });
  return `Titles containing “${k}” are now excluded from ${cat.name}.`;
}
