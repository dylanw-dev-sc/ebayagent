import type { ColorConfig, ColorPriority } from "../domain/types";
import { findPhraseTokenPositions, joinHuman, normalizePhrase, tokenize, uniq } from "../text";

/**
 * Garment color, read from the listing title and the seller's "Color" item
 * specific with deterministic phrase matching. Photos are never analyzed.
 */

/** Phrases that contain color words but don't describe the garment's color. */
export const NOT_A_COLOR_PHRASES = [
  "black label",
  "purple label",
  "blue label",
  "gold label",
  "green label",
  "orange label",
  "red label",
  "white label",
  "black fleece",
  "black watch",
  "camel hair",
  "camelhair",
];

/**
 * General colors that a more specific shade refines. eBay's "Color" item
 * specific is often generic ("Blue") while the title names the shade
 * ("Navy"); the general color is dropped when the shade is present.
 */
const GENERAL_COLORS_OF: Record<string, string[]> = {
  navy: ["blue"],
  light_blue: ["blue"],
  charcoal: ["grey", "black"],
  cream: ["white", "beige"],
  beige: ["brown"],
  camel: ["beige", "brown"],
  khaki: ["beige", "green", "brown"],
  olive: ["green", "brown"],
  burgundy: ["red", "purple"],
};

export const COLOR_PRIORITY_LABEL: Record<ColorPriority, string> = {
  prefer: "Prefer",
  neutral: "Neutral",
  avoid: "Generally avoid",
  exclude: "Exclude",
};

export interface ColorReading {
  /** Detected color keys: title colors first, in the order they appear. */
  keys: string[];
  source: "title" | "item_specifics" | "both" | "none";
  /** The seller's "Color" item specific, verbatim. */
  aspect: string | null;
  /** The title words that named a color, for explanations. */
  titleWords: string[];
}

interface CompiledColor {
  key: string;
  phrase: string;
  tokens: string[];
}

function compile(colors: ColorConfig[]): CompiledColor[] {
  const out: CompiledColor[] = [];
  for (const c of colors) {
    for (const kw of uniq(c.keywords)) {
      const phrase = normalizePhrase(kw);
      if (phrase) out.push({ key: c.key, phrase, tokens: tokenize(phrase) });
    }
  }
  // Longest phrase first: "navy blue" is navy, not navy + blue; "light blue" isn't blue.
  return out.sort((a, b) => b.tokens.length - a.tokens.length || b.phrase.length - a.phrase.length);
}

function detect(text: string, compiled: CompiledColor[], ignore: string[][]): Array<{ key: string; phrase: string; pos: number }> {
  const tokens = tokenize(normalizePhrase(text));
  const blank = (pos: number, len: number) => {
    for (let j = 0; j < len; j++) tokens[pos + j] = "";
  };
  for (const ig of ignore) for (const p of findPhraseTokenPositions(tokens, ig)) blank(p, ig.length);
  const found: Array<{ key: string; phrase: string; pos: number }> = [];
  for (const c of compiled) {
    for (const p of findPhraseTokenPositions(tokens, c.tokens)) {
      if (tokens[p] === "") continue; // already consumed by a longer phrase at an overlapping position
      found.push({ key: c.key, phrase: c.phrase, pos: p });
      blank(p, c.tokens.length);
    }
  }
  return found.sort((a, b) => a.pos - b.pos);
}

/**
 * Read the garment's colors. `ignorePhrases` are blanked out of the title
 * first (your brand names, aliases and never-match phrases), so a brand like
 * "Ralph Lauren Purple Label" doesn't read as purple.
 */
export function readColors(input: { title: string; colorAspect: string | null }, colors: ColorConfig[], ignorePhrases: string[] = []): ColorReading {
  const compiled = compile(colors);
  const ignore = uniq([...NOT_A_COLOR_PHRASES, ...ignorePhrases].map((p) => normalizePhrase(p)).filter(Boolean))
    .sort((a, b) => b.length - a.length)
    .map(tokenize);
  const fromTitle = detect(input.title, compiled, ignore);
  const fromAspect = input.colorAspect ? detect(input.colorAspect, compiled, ignore) : [];
  const all = uniq([...fromTitle.map((f) => f.key), ...fromAspect.map((f) => f.key)]);
  const keys = all.filter((k) => !all.some((o) => o !== k && (GENERAL_COLORS_OF[o] ?? []).includes(k)));
  const source = fromTitle.length && fromAspect.length ? "both" : fromTitle.length ? "title" : fromAspect.length ? "item_specifics" : "none";
  return {
    keys,
    source: keys.length ? source : "none",
    aspect: input.colorAspect?.trim() || null,
    titleWords: uniq(fromTitle.map((f) => f.phrase)),
  };
}

export interface ColorAssessment {
  /** Display names of the detected colors. */
  names: string[];
  excluded: string[];
  /** Detected colors you did not exclude. */
  allowed: string[];
  preferred: string[];
  avoided: string[];
  /** Ranking only: +1 a preferred color, −1 an avoided or excluded one. Never a quality rating. */
  score: number;
  /** e.g. "Navy, White" (null when no color was found). */
  summary: string | null;
}

export function assessColors(keys: string[], colors: ColorConfig[]): ColorAssessment {
  const byKey = new Map(colors.map((c) => [c.key, c]));
  const found = keys.map((k) => byKey.get(k)).filter((c): c is ColorConfig => c !== undefined);
  const names = found.map((c) => c.name);
  const named = (p: ColorPriority) => found.filter((c) => c.priority === p).map((c) => c.name);
  const excluded = named("exclude");
  const preferred = named("prefer");
  const avoided = named("avoid");
  return {
    names,
    excluded,
    allowed: found.filter((c) => c.priority !== "exclude").map((c) => c.name),
    preferred,
    avoided,
    score: (preferred.length ? 1 : 0) - (avoided.length || excluded.length ? 1 : 0),
    summary: names.length ? names.join(", ") : null,
  };
}

/** "navy" / "navy and white" — color names in running text. */
export function colorList(names: string[]): string {
  return joinHuman(names.map((n) => n.toLowerCase()));
}

/** Display swatches for the seeded colors (UI only; never used for matching). */
export const COLOR_SWATCH: Record<string, string> = {
  black: "#1c1c1e",
  white: "#ffffff",
  cream: "#efe6d2",
  grey: "#9a9ca1",
  charcoal: "#45484e",
  navy: "#1f2a44",
  blue: "#2f5fa8",
  light_blue: "#a9c4e4",
  brown: "#6b4a33",
  beige: "#cdb894",
  camel: "#b98b54",
  khaki: "#b7a77a",
  olive: "#6b6b3a",
  green: "#2f6b45",
  burgundy: "#6e1f2e",
  red: "#b3262e",
  pink: "#e3a1b3",
  purple: "#6a4c93",
  yellow: "#e2c044",
  orange: "#d4712a",
  multicolor: "conic-gradient(#b3262e, #e2c044, #2f6b45, #2f5fa8, #6a4c93, #b3262e)",
};
