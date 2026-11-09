import type { BrandConfig } from "../domain/types";
import { containsPhrase, findPhraseTokenPositions, joinHuman, normalizePhrase, tokenize, uniq } from "../text";

/**
 * Deterministic brand detection.
 *
 * Rules (in order):
 *  1. Brand names and aliases are matched as whole normalized phrases
 *     (accent/case/punctuation-insensitive). "Ralph Lauren" alone never
 *     matches "Ralph Lauren Purple Label" because the full phrase is required.
 *  2. Longest match wins: if one brand's phrase is contained inside another
 *     brand's longer phrase at the same position, only the longer one counts.
 *  3. A brand's exclude phrases (e.g. "Z Zegna" for Zegna) veto that brand.
 *  4. Mentions in a fabric/mill context ("Loro Piana fabric", "blazer in Zegna
 *     wool", "fabric by Loro Piana") are not treated as the garment brand.
 *  5. Structured item specifics (Brand aspect) win when they name a configured
 *     brand; disagreement between item specifics and title → conflict (review).
 */

export type BrandStatus =
  | "confirmed" // single, consistent brand
  | "conflict" // item specifics and title disagree
  | "ambiguous" // several configured brands mentioned as garment brands
  | "fabric_reference" // configured brand mentioned only as a fabric / mill
  | "excluded_phrase" // brand vetoed by one of its exclude phrases
  | "none"; // no configured brand found

export interface BrandDetection {
  brandId: number | null;
  status: BrandStatus;
  source: "item_specifics" | "title" | null;
  matchedPhrase: string | null;
  /** Other configured brands involved (for conflict / ambiguous explanations). */
  otherBrandIds: number[];
  note: string;
}

interface CompiledPhrase {
  text: string;
  tokens: string[];
}

export interface CompiledBrand {
  id: number;
  name: string;
  enabled: boolean;
  phrases: CompiledPhrase[];
  /** Normalized exclude phrases with their original spelling for explanations. */
  excludePhrases: Array<{ norm: string; original: string }>;
}

export interface BrandMatcher {
  brands: CompiledBrand[];
  byId: Map<number, CompiledBrand>;
}

interface Mention {
  brandId: number;
  phrase: string;
  start: number;
  end: number;
  fabricContext: boolean;
}

const NON_BRAND_VALUES = new Set([
  "unbranded",
  "unknown",
  "does not apply",
  "na",
  "n a",
  "none",
  "no brand",
  "generic",
  "not specified",
  "see description",
]);

const FABRIC_WORDS = new Set([
  "fabric",
  "fabrics",
  "cloth",
  "cloths",
  "textile",
  "textiles",
  "tessuto",
  "tessuti",
  "mill",
  "mills",
  "lanificio",
  "yarn",
  "yarns",
]);

const GARMENT_WORDS = new Set([
  "jacket",
  "jackets",
  "blazer",
  "blazers",
  "coat",
  "coats",
  "overcoat",
  "topcoat",
  "parka",
  "bomber",
  "gilet",
  "vest",
  "shirt",
  "shirts",
  "overshirt",
  "polo",
  "tee",
  "tshirt",
  "t",
  "sweater",
  "jumper",
  "cardigan",
  "suit",
  "sportcoat",
  "sport",
  "trousers",
  "pants",
  "chinos",
  "knit",
  "henley",
  "trucker",
]);

const PRECEDING_FABRIC_LINKS = new Set(["in", "with", "using", "from"]);

export function compileBrandMatcher(brands: BrandConfig[]): BrandMatcher {
  const compiled: CompiledBrand[] = brands.map((b) => {
    const phraseTexts = uniq([b.name, ...b.aliases].map(normalizePhrase).filter(Boolean));
    return {
      id: b.id,
      name: b.name,
      enabled: b.enabled,
      phrases: phraseTexts.map((text) => ({ text, tokens: tokenize(text) })),
      excludePhrases: b.excludePhrases
        .map((original) => ({ norm: normalizePhrase(original), original: original.trim() }))
        .filter((x, i, all) => x.norm && all.findIndex((y) => y.norm === x.norm) === i),
    };
  });
  return { brands: compiled, byId: new Map(compiled.map((b) => [b.id, b])) };
}

function findMentions(tokens: string[], matcher: BrandMatcher, withFabricContext: boolean): Mention[] {
  const raw: Mention[] = [];
  for (const brand of matcher.brands) {
    for (const phrase of brand.phrases) {
      for (const start of findPhraseTokenPositions(tokens, phrase.tokens)) {
        const end = start + phrase.tokens.length;
        raw.push({
          brandId: brand.id,
          phrase: phrase.text,
          start,
          end,
          fabricContext: withFabricContext ? isFabricContext(tokens, start, end) : false,
        });
      }
    }
  }
  // Longest match wins across different brands sharing a span.
  return raw.filter(
    (m) =>
      !raw.some(
        (o) =>
          o !== m &&
          o.brandId !== m.brandId &&
          o.start <= m.start &&
          o.end >= m.end &&
          o.end - o.start > m.end - m.start,
      ),
  );
}

function isFabricContext(tokens: string[], start: number, end: number): boolean {
  // Look ahead: "<brand> fabric", "<brand> super 150s wool cloth". Stop at a garment word.
  for (let i = end; i < Math.min(tokens.length, end + 4); i++) {
    if (GARMENT_WORDS.has(tokens[i])) break;
    if (FABRIC_WORDS.has(tokens[i])) return true;
  }
  const p1 = tokens[start - 1];
  const p2 = tokens[start - 2];
  if (p1 === "by" && p2 && FABRIC_WORDS.has(p2)) return true; // "fabric by Loro Piana"
  if (p1 && PRECEDING_FABRIC_LINKS.has(p1) && p2 && (FABRIC_WORDS.has(p2) || GARMENT_WORDS.has(p2) || p2 === "made")) {
    return true; // "blazer in Loro Piana wool", "made with Loro Piana"
  }
  return false;
}

function excludedBrandIds(normalizedTexts: string[], matcher: BrandMatcher): Map<number, string> {
  const result = new Map<number, string>();
  for (const brand of matcher.brands) {
    for (const phrase of brand.excludePhrases) {
      if (normalizedTexts.some((t) => containsPhrase(t, phrase.norm))) {
        result.set(brand.id, phrase.original);
        break;
      }
    }
  }
  return result;
}

function firstByPosition(mentions: Mention[]): Mention | undefined {
  return [...mentions].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))[0];
}

export function detectBrand(input: { title: string; brandAspect: string | null }, matcher: BrandMatcher): BrandDetection {
  const titleNorm = normalizePhrase(input.title);
  const aspectNormRaw = normalizePhrase(input.brandAspect);
  const aspectNorm = NON_BRAND_VALUES.has(aspectNormRaw) ? "" : aspectNormRaw;
  const nameOf = (id: number) => matcher.byId.get(id)?.name ?? `#${id}`;

  const excluded = excludedBrandIds([titleNorm, aspectNorm].filter(Boolean), matcher);

  const titleMentionsAll = findMentions(tokenize(titleNorm), matcher, true);
  const aspectMentionsAll = aspectNorm ? findMentions(tokenize(aspectNorm), matcher, false) : [];

  const titleMentions = titleMentionsAll.filter((m) => !excluded.has(m.brandId));
  const aspectMentions = aspectMentionsAll.filter((m) => !excluded.has(m.brandId));

  const garmentBrandIds = uniq(titleMentions.filter((m) => !m.fabricContext).map((m) => m.brandId));
  const fabricOnlyBrandIds = uniq(titleMentions.map((m) => m.brandId)).filter((id) => !garmentBrandIds.includes(id));

  // --- Item specifics name a configured brand ---------------------------------
  const aspectMention = firstByPosition(aspectMentions);
  if (aspectMention) {
    const aspectBrandId = aspectMention.brandId;
    const others = garmentBrandIds.filter((id) => id !== aspectBrandId);
    if (others.length === 0) {
      return {
        brandId: aspectBrandId,
        status: "confirmed",
        source: "item_specifics",
        matchedPhrase: aspectMention.phrase,
        otherBrandIds: [],
        note: `Brand from item specifics: ${input.brandAspect}`,
      };
    }
    return {
      brandId: aspectBrandId,
      status: "conflict",
      source: "item_specifics",
      matchedPhrase: aspectMention.phrase,
      otherBrandIds: others,
      note: `Item specifics list ${nameOf(aspectBrandId)}, but the title also mentions ${joinHuman(others.map(nameOf))}`,
    };
  }

  // --- Item specifics name a brand we don't track ------------------------------
  if (aspectNorm && garmentBrandIds.length > 0) {
    const titleMention = firstByPosition(titleMentions.filter((m) => !m.fabricContext))!;
    const consistent = containsPhrase(titleMention.phrase, aspectNorm) || containsPhrase(aspectNorm, titleMention.phrase);
    if (consistent) {
      return {
        brandId: titleMention.brandId,
        status: garmentBrandIds.length > 1 ? "ambiguous" : "confirmed",
        source: "title",
        matchedPhrase: titleMention.phrase,
        otherBrandIds: garmentBrandIds.filter((id) => id !== titleMention.brandId),
        note: `Brand from title (“${nameOf(titleMention.brandId)}”); item specifics list “${input.brandAspect}”`,
      };
    }
    return {
      brandId: titleMention.brandId,
      status: "conflict",
      source: "title",
      matchedPhrase: titleMention.phrase,
      otherBrandIds: garmentBrandIds.filter((id) => id !== titleMention.brandId),
      note: `Title mentions ${nameOf(titleMention.brandId)}, but item specifics list the brand as “${input.brandAspect}”`,
    };
  }

  // --- Title only ---------------------------------------------------------------
  if (garmentBrandIds.length === 1) {
    const m = firstByPosition(titleMentions.filter((x) => x.brandId === garmentBrandIds[0]))!;
    return {
      brandId: m.brandId,
      status: "confirmed",
      source: "title",
      matchedPhrase: m.phrase,
      otherBrandIds: [],
      note: `Brand from title (“${m.phrase}”)${input.brandAspect ? "" : "; no brand in item specifics"}`,
    };
  }
  if (garmentBrandIds.length > 1) {
    const m = firstByPosition(titleMentions.filter((x) => !x.fabricContext))!;
    return {
      brandId: m.brandId,
      status: "ambiguous",
      source: "title",
      matchedPhrase: m.phrase,
      otherBrandIds: garmentBrandIds.filter((id) => id !== m.brandId),
      note: `Title mentions several of your brands: ${joinHuman(garmentBrandIds.map(nameOf))}`,
    };
  }
  if (fabricOnlyBrandIds.length > 0) {
    const id = fabricOnlyBrandIds[0];
    return {
      brandId: id,
      status: "fabric_reference",
      source: "title",
      matchedPhrase: titleMentions.find((m) => m.brandId === id)?.phrase ?? null,
      otherBrandIds: fabricOnlyBrandIds.slice(1),
      note: `${nameOf(id)} is mentioned only as a fabric or mill${aspectNorm ? ` (item specifics brand: “${input.brandAspect}”)` : ""} — the garment may be made by another brand`,
    };
  }
  if (excluded.size > 0) {
    const [id, phrase] = Array.from(excluded.entries())[0];
    const hadMention = titleMentionsAll.some((m) => m.brandId === id) || aspectMentionsAll.some((m) => m.brandId === id);
    if (hadMention) {
      return {
        brandId: id,
        status: "excluded_phrase",
        source: "title",
        matchedPhrase: phrase,
        otherBrandIds: [],
        note: `Contains “${phrase}”, which is excluded for ${nameOf(id)}`,
      };
    }
  }
  return {
    brandId: null,
    status: "none",
    source: null,
    matchedPhrase: null,
    otherBrandIds: [],
    note: aspectNorm
      ? `Brand “${input.brandAspect}” is not one of your brands`
      : "None of your brands appear in the title",
  };
}
