/**
 * Text normalization helpers shared by the matching engines.
 *
 * `normalizePhrase` is used for brand / keyword phrase matching. It is
 * accent-insensitive, case-insensitive and punctuation-insensitive so that
 * "A.P.C." == "APC", "Officine Générale" == "Officine Generale" and
 * "Drake’s" == "Drakes". It is NOT suitable for sizes (it would turn "16.5"
 * into "165"); size parsing has its own tokenizer.
 */
export function stripAccents(input: string): string {
  return input.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function normalizePhrase(input: string | null | undefined): string {
  if (!input) return "";
  return stripAccents(input)
    .toLowerCase()
    .replace(/[’'`´]/g, "") // drake's -> drakes
    .replace(/\./g, "") // a.p.c. -> apc, v.c. -> vc
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Whole-phrase containment on normalized text (token boundaries respected). */
export function containsPhrase(normalizedHaystack: string, normalizedNeedle: string): boolean {
  if (!normalizedNeedle) return false;
  return ` ${normalizedHaystack} `.includes(` ${normalizedNeedle} `);
}

/** All start offsets (in tokens) where `needle` occurs in `haystack` (both normalized). */
export function findPhraseTokenPositions(haystackTokens: string[], needleTokens: string[]): number[] {
  const positions: number[] = [];
  if (needleTokens.length === 0 || needleTokens.length > haystackTokens.length) return positions;
  outer: for (let i = 0; i <= haystackTokens.length - needleTokens.length; i++) {
    for (let j = 0; j < needleTokens.length; j++) {
      if (haystackTokens[i + j] !== needleTokens[j]) continue outer;
    }
    positions.push(i);
  }
  return positions;
}

export function tokenize(normalized: string): string[] {
  return normalized ? normalized.split(" ") : [];
}

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function joinHuman(items: string[], conjunction = "and"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

/** Split a comma / newline separated user-entered list into trimmed, non-empty unique values. */
export function parseList(input: string | null | undefined): string[] {
  if (!input) return [];
  return uniq(
    input
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
