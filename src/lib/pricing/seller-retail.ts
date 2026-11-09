import { parseMoneyToMinor } from "../money";

/**
 * Retail price the SELLER states in a listing ("Retail $1,295", "MSRP: $895",
 * "$450 retail", "originally $600"). It's an unverified claim: shown as such and
 * used only when you choose to, never automatically.
 */

const MIN_MINOR = 2_000; // $20 — below this it's not a garment's retail price
const MAX_MINOR = 5_000_000; // $50,000

const AMOUNT = String.raw`(?:US\s?)?\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)`;
const FILLER = String.raw`(?:\s*(?:price|value|tag))?\s*(?:is|was|of|at|for|:|-|–|—)?\s*(?:approx\.?|approximately|around|about|over|nearly|almost)?\s*`;

/** "retail $1,295", "MSRP: $895", "retails for $450", "originally $600", "orig. $600", "list price $700". */
const BEFORE = new RegExp(
  String.raw`\b(retail(?:s|ed)?(?:\s+for)?|msrp|m\.s\.r\.p\.?|rrp|list\s+price|original(?:ly)?(?:\s+(?:retail|priced))?|orig\.?)` + FILLER + AMOUNT,
  "gi",
);
/** "$1,295 retail", "$895 MSRP". */
const AFTER = new RegExp(AMOUNT + String.raw`\s*(?:usd\s*)?(retail|msrp|rrp)\b`, "gi");

/** Words right after "retail" that show it isn't a price ("retail store", "retail packaging"). */
const NOT_A_PRICE_AFTER = /^\s*(?:store|stores|shop|shops|outlet|location|packaging|box|bag|tag(?:s)?\s+attached|ready)\b/i;

export interface SellerStatedRetail {
  minor: number;
  /** The words as the seller wrote them, e.g. "Retail $1,295". */
  phrase: string;
}

function candidates(text: string): SellerStatedRetail[] {
  const out: SellerStatedRetail[] = [];
  for (const m of text.matchAll(BEFORE)) {
    const afterWord = text.slice((m.index ?? 0) + m[1].length);
    if (NOT_A_PRICE_AFTER.test(afterWord)) continue;
    const minor = parseMoneyToMinor(m[2]);
    if (minor !== null) out.push({ minor, phrase: m[0].trim() });
  }
  for (const m of text.matchAll(AFTER)) {
    const minor = parseMoneyToMinor(m[1]);
    if (minor !== null) out.push({ minor, phrase: m[0].trim() });
  }
  return out;
}

/** The first plausible stated retail price in the title, then the description. */
export function findSellerStatedRetail(input: { title: string; description?: string | null }): SellerStatedRetail | null {
  for (const text of [input.title, input.description ?? ""]) {
    const clean = text.replace(/\s+/g, " ");
    const found = candidates(clean).find((c) => c.minor >= MIN_MINOR && c.minor <= MAX_MINOR);
    if (found) return found;
  }
  return null;
}
