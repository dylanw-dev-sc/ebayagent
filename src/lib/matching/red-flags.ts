import { normalizePhrase, tokenize, findPhraseTokenPositions } from "../text";

/**
 * Counterfeit red flags: phrases like "replica" or "inspired by" in the title
 * or description. Negated mentions ("not a replica", "no fakes") don't count.
 */

export type RedFlagPolicy = "exclude" | "review" | "flag";

export const DEFAULT_RED_FLAG_PHRASES = [
  "replica",
  "1:1",
  "dupe",
  "inspired by",
  "in the style of",
  "homage",
  "mirror quality",
  "AAA quality",
  "fake",
  "counterfeit",
  "knockoff",
  "knock off",
  "not authentic",
  "unauthentic",
  "bootleg",
];

const NEGATORS = new Set(["not", "no", "never", "non", "isnt", "isn", "aint", "zero"]);

/** "1:1" normalizes to "1 1"; keep it distinct from ordinary numbers by requiring the colon form. */
function normalizeFlag(phrase: string): string {
  return normalizePhrase(phrase.replace(/(\d)\s*:\s*(\d)/g, "$1colon$2"));
}

function prepText(text: string): string[] {
  return tokenize(normalizeFlag(text));
}

export function findRedFlags(input: { title: string; description: string | null }, phrases: string[]): string[] {
  const found: string[] = [];
  const texts = [input.title, input.description ?? ""].filter(Boolean).map(prepText);
  for (const phrase of phrases) {
    const needle = tokenize(normalizeFlag(phrase));
    if (!needle.length) continue;
    const hit = texts.some((tokens) =>
      findPhraseTokenPositions(tokens, needle).some((pos) => {
        // Negated within the two preceding words: "not a replica", "no fakes".
        const before = tokens.slice(Math.max(0, pos - 2), pos);
        return !before.some((t) => NEGATORS.has(t));
      }),
    );
    if (hit) found.push(phrase);
  }
  return found;
}
