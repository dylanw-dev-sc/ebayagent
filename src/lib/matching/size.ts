import type { SizePrefs, SizeSystem } from "../domain/types";
import { joinHuman, stripAccents, uniq } from "../text";

/**
 * Size parsing and matching.
 *
 * Supports three size families:
 *  - alpha:     XS…5XL, with Tall variants (LT, XLT). "Large" == "L", "Extra Large" == "XL".
 *  - tailored:  chest + length (44R, "44 Regular", "44 Reg"); EU/IT sizes ("IT 54").
 *  - neck:      neck/sleeve dress-shirt sizes ("16.5/35", "16 1/2 34-35").
 *
 * Only unambiguous equivalents are treated as equal (44R == "44 Regular").
 * Letter sizes are never converted into tailored sizes (XL ≠ 44R), and EU sizes
 * or chest sizes without a length are sent to review rather than assumed.
 */

export type AlphaBase = "XXS" | "XS" | "S" | "M" | "L" | "XL" | "XXL" | "3XL" | "4XL" | "5XL";
export type TailoredLength = "S" | "R" | "L" | "XL";

export type SizeValue =
  | { kind: "alpha"; base: AlphaBase; tall: boolean }
  | { kind: "tailored"; chest: number; length: TailoredLength | null; system: "US" | "EU" }
  | { kind: "neck"; neck: number; sleeves: number[] }
  | { kind: "numeric"; value: number }
  | { kind: "other"; text: string };

export interface SizeReading {
  source: "item_specifics" | "title" | "none";
  raw: string | null;
  values: SizeValue[];
  /** Size(s) found in the title when they disagree with item specifics. */
  titleValues: SizeValue[];
  /** Title disagreed with item specifics. */
  conflictNote: string | null;
}

export interface SizeEvaluation {
  state: "match" | "review" | "no_match";
  message: string;
  /** Short label for display, e.g. "L", "44R", "16.5/35". */
  label: string | null;
}

const ALPHA_ORDER: AlphaBase[] = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"];

const ALPHA_NAMES: Record<AlphaBase, string> = {
  XXS: "XXS",
  XS: "Extra Small",
  S: "Small",
  M: "Medium",
  L: "Large",
  XL: "Extra Large",
  XXL: "XXL",
  "3XL": "3XL",
  "4XL": "4XL",
  "5XL": "5XL",
};

const LENGTH_NAMES: Record<TailoredLength, string> = { S: "Short", R: "Regular", L: "Long", XL: "Extra Long" };

export function sizeKey(v: SizeValue): string {
  switch (v.kind) {
    case "alpha":
      return `${v.base}${v.tall ? "T" : ""}`;
    case "tailored":
      return v.system === "EU" ? `EU ${v.chest}${v.length ?? ""}` : `${v.chest}${v.length ?? ""}`;
    case "neck":
      return v.sleeves.length ? `${formatNum(v.neck)}/${v.sleeves.map(formatNum).join("-")}` : `${formatNum(v.neck)} neck`;
    case "numeric":
      return `${formatNum(v.value)}`;
    case "other":
      return v.text;
  }
}

export function sizeLongName(v: SizeValue): string {
  switch (v.kind) {
    case "alpha":
      return `${ALPHA_NAMES[v.base]}${v.tall ? " Tall" : ""}`;
    case "tailored":
      return v.system === "EU"
        ? `EU ${v.chest}${v.length ? " " + LENGTH_NAMES[v.length] : ""}`
        : `${v.chest}${v.length ?? ""}`;
    default:
      return sizeKey(v);
  }
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

function prep(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/½/g, ".5")
    .replace(/(\d+)\s+1\/2\b/g, "$1.5")
    .replace(/[’'`]/g, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Pattern tables ----------------------------------------------------------

const ALPHA_PATTERNS: Array<[RegExp, AlphaBase]> = [
  [/^(5xl|xxxxxl|5x)$/, "5XL"],
  [/^(4xl|xxxxl|4x)$/, "4XL"],
  [/^(3xl|xxxl|3x|xxx large|xxx-large)$/, "3XL"],
  [/^(2xl|xxl|2x|xx large|xx-large|xxlarge|2x large|2x-large)$/, "XXL"],
  [/^(xl|x large|x-large|xlarge|extra large|extra-large|ex large|x lg)$/, "XL"],
  [/^(l|lg|lrg|large)$/, "L"],
  [/^(m|md|med|medium)$/, "M"],
  [/^(s|sm|sml|small)$/, "S"],
  [/^(xs|x small|x-small|xsmall|extra small|extra-small)$/, "XS"],
  [/^(xxs|2xs|xx small|xx-small)$/, "XXS"],
];

const TALL_PATTERNS: Array<[RegExp, AlphaBase]> = [
  [/^(xxlt|2xlt|xxl tall|2xl tall)$/, "XXL"],
  [/^(xlt|xl tall|x large tall|extra large tall|xlarge tall)$/, "XL"],
  [/^(lt|l tall|large tall|lg tall)$/, "L"],
  [/^(mt|m tall|medium tall)$/, "M"],
];

function parseAlphaPhrase(p: string): SizeValue | null {
  const s = p.trim();
  for (const [re, base] of TALL_PATTERNS) if (re.test(s)) return { kind: "alpha", base, tall: true };
  for (const [re, base] of ALPHA_PATTERNS) if (re.test(s)) return { kind: "alpha", base, tall: false };
  return null;
}

const LENGTH_MAP: Record<string, TailoredLength> = {
  r: "R",
  reg: "R",
  regular: "R",
  s: "S",
  sh: "S",
  short: "S",
  l: "L",
  lg: "L",
  long: "L",
  xl: "XL",
  xlong: "XL",
  "x long": "XL",
  "extra long": "XL",
};

const TAILORED_RE = /\b([3-5]\d)\s?(r|reg|regular|s|short|l|long|xl|xlong|x long|extra long)\b/;
const EU_RE_PREFIX = /\b(?:it|eu|ita|euro|eur|italy|italian|ital)\s?([4-6]\d)(?:\s?(r|reg|regular|l|long|s|short))?\b/;
const EU_RE_SUFFIX = /\b([4-6]\d)\s?(?:it|eu|ita|euro|eur)\b/;
const NECK_RE = /\b(1[3-9](?:\.5)?)\s?(?:\/|x|-|\s)\s?(3[0-9])(?:\s?(?:\/|-)\s?(3[0-9]))?\b/;

/** Parse a size string from item specifics (or a user-entered accepted size). */
export function parseSizeText(text: string | null | undefined): SizeValue[] {
  if (!text) return [];
  const s = prep(text);
  if (!s) return [];
  if (/^(one size|os|osfa|one size fits all)$/.test(s)) return [{ kind: "other", text: "One Size" }];

  // Neck / sleeve first, because it also uses "/" as a separator.
  const neck = NECK_RE.exec(s);
  if (neck) {
    const sleeves = [neck[2], neck[3]].filter(Boolean).map(Number);
    return [{ kind: "neck", neck: Number(neck[1]), sleeves: uniq(sleeves) }];
  }
  const neckOnly = /^(?:neck\s?|collar\s?)?(1[3-9](?:\.5)?)\s?(?:in|inch|")?(?:\s?neck)?$/.exec(s);
  if (neckOnly && /neck|collar|\./.test(s)) return [{ kind: "neck", neck: Number(neckOnly[1]), sleeves: [] }];

  const eu = EU_RE_PREFIX.exec(s) ?? EU_RE_SUFFIX.exec(s);
  if (eu) {
    const len = eu[2] ? LENGTH_MAP[eu[2]] ?? null : null;
    return [{ kind: "tailored", chest: Number(eu[1]), length: len, system: "EU" }];
  }

  const tailored = TAILORED_RE.exec(s);
  if (tailored) {
    return [{ kind: "tailored", chest: Number(tailored[1]), length: LENGTH_MAP[tailored[2]] ?? null, system: "US" }];
  }

  // Strip filler words and split alternatives: "L/XL", "Large, X-Large", "M or L".
  const cleaned = s
    .replace(/\b(mens|men s|men|size|sz|us|tagged|tag|label|fits|fit|regular|standard)\b/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned
    .split(/\s?(?:\/|,|\||\bor\b|&)\s?/)
    .map((p) => p.trim())
    .filter(Boolean);
  const values: SizeValue[] = [];
  for (const part of parts) {
    const alpha = parseAlphaPhrase(part);
    if (alpha) {
      values.push(alpha);
      continue;
    }
    const num = /^(\d{2}(?:\.5)?)$/.exec(part);
    if (num) {
      values.push({ kind: "numeric", value: Number(num[1]) });
      continue;
    }
    // e.g. "m 38-40": take the first token that is a letter size.
    for (const token of part.split(" ")) {
      const t = parseAlphaPhrase(token);
      if (t) {
        values.push(t);
        break;
      }
    }
  }
  if (values.length > 0) return dedupeValues(values);
  return [{ kind: "other", text: text.trim() }];
}

function dedupeValues(values: SizeValue[]): SizeValue[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const k = sizeKey(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Extract a size from a listing title. More conservative than item specifics:
 * single letters (L, M, S) need a cue ("Size L", "Mens L") or must end the title.
 */
const TITLE_NOISE =
  /\b(large|small|medium|big|xl)\s(logo|logos|pony|check|checks|checked|plaid|print|graphic|stripe|stripes|striped|pattern|weight|wash|rise|houndstooth|herringbone|collar|pocket|button|buttons)\b/g;

export function parseSizeFromTitle(title: string): SizeValue[] {
  const s = prep(title)
    .replace(/[^a-z0-9./\s-]/g, " ")
    .replace(TITLE_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const neck = NECK_RE.exec(s);
  if (neck && /\b(neck|collar|sleeve|dress shirt|shirt)\b/.test(s)) {
    const sleeves = [neck[2], neck[3]].filter(Boolean).map(Number);
    return [{ kind: "neck", neck: Number(neck[1]), sleeves: uniq(sleeves) }];
  }
  const eu = EU_RE_PREFIX.exec(s) ?? EU_RE_SUFFIX.exec(s);
  if (eu) {
    const len = eu[2] ? LENGTH_MAP[eu[2]] ?? null : null;
    return [{ kind: "tailored", chest: Number(eu[1]), length: len, system: "EU" }];
  }
  const tailored = /\b([3-5]\d)\s?(r|reg|regular|s|short|l|long)\b/.exec(s);
  if (tailored && !/\b([3-5]\d)\s?(s|l)\s?(\/|-)/.test(s)) {
    return [{ kind: "tailored", chest: Number(tailored[1]), length: LENGTH_MAP[tailored[2]] ?? null, system: "US" }];
  }
  // Explicit multi-word / unambiguous alpha tokens anywhere.
  const words: Array<[RegExp, SizeValue]> = [
    [/\b(xlt|xl tall)\b/, { kind: "alpha", base: "XL", tall: true }],
    [/\b(lt|large tall)\b/, { kind: "alpha", base: "L", tall: true }],
    [/\b(xxxl|3xl)\b/, { kind: "alpha", base: "3XL", tall: false }],
    [/\b(xxl|2xl|xx-large|xx large)\b/, { kind: "alpha", base: "XXL", tall: false }],
    [/\b(xl|x-large|x large|xlarge|extra large|extra-large)\b/, { kind: "alpha", base: "XL", tall: false }],
    [/\b(large)\b/, { kind: "alpha", base: "L", tall: false }],
    [/\b(medium)\b/, { kind: "alpha", base: "M", tall: false }],
    [/\b(small)\b/, { kind: "alpha", base: "S", tall: false }],
    [/\b(xs|x-small|extra small)\b/, { kind: "alpha", base: "XS", tall: false }],
  ];
  const found: SizeValue[] = [];
  for (const [re, v] of words) {
    if (re.test(s)) {
      found.push(v);
      // "x-large" also contains "large": stop at the most specific hit.
      break;
    }
  }
  // Cue-based single letters: "size l", "sz m", "mens l", "men s l".
  const cue = /\b(?:size|sz|mens|men s|tagged|tag)\s([sml])\b/.exec(s);
  if (cue && found.length === 0) {
    const v = parseAlphaPhrase(cue[1]);
    if (v) found.push(v);
  }
  // Trailing single letter: "... oxford shirt blue l"
  const trailing = /\s([sml])$/.exec(s);
  if (trailing && found.length === 0) {
    const v = parseAlphaPhrase(trailing[1]);
    if (v) found.push(v);
  }
  // Alternatives like "l/xl" in title.
  const alt = /\b(s|m|l|xl|xxl)\s?\/\s?(m|l|xl|xxl)\b/.exec(s);
  if (alt) {
    const a = parseAlphaPhrase(alt[1]);
    const b = parseAlphaPhrase(alt[2]);
    return dedupeValues([a, b].filter((x): x is SizeValue => !!x));
  }
  return dedupeValues(found);
}

/** True when `detail` adds information to `base` without contradicting it (e.g. "44" → "44R"). */
function refines(detail: SizeValue, base: SizeValue): boolean {
  if (detail.kind !== "tailored" || detail.length === null) return false;
  if (base.kind === "numeric") return base.value === detail.chest && detail.system === "US";
  if (base.kind === "tailored") return base.length === null && base.chest === detail.chest && base.system === detail.system;
  return false;
}

export function readListingSize(input: { sizeAspect: string | null; title: string }): SizeReading {
  const fromAspect = parseSizeText(input.sizeAspect);
  const fromTitle = parseSizeFromTitle(input.title);
  let usableAspect: SizeValue[] = fromAspect.filter((v) => v.kind !== "other");
  // Title can refine a vaguer item-specifics size: "44" + title "44R" → 44R.
  if (usableAspect.length === 1 && fromTitle.length === 1 && refines(fromTitle[0], usableAspect[0])) {
    usableAspect = [fromTitle[0]];
  }
  if (usableAspect.length > 0) {
    let conflictNote: string | null = null;
    let titleValues: SizeValue[] = [];
    if (fromTitle.length > 0) {
      const aspectKeys = new Set(usableAspect.map(sizeKey));
      if (!fromTitle.some((v) => aspectKeys.has(sizeKey(v)))) {
        titleValues = fromTitle;
        conflictNote = `Item specifics say ${joinHuman(usableAspect.map(sizeKey), "or")}, but the title says ${joinHuman(fromTitle.map(sizeKey), "or")}`;
      }
    }
    return { source: "item_specifics", raw: input.sizeAspect, values: usableAspect, titleValues, conflictNote };
  }
  if (fromTitle.length > 0) {
    return { source: "title", raw: fromTitle.map(sizeKey).join(" / "), values: fromTitle, titleValues: [], conflictNote: null };
  }
  if (fromAspect.length > 0) {
    return { source: "item_specifics", raw: input.sizeAspect, values: fromAspect, titleValues: [], conflictNote: null };
  }
  return { source: "none", raw: null, values: [], titleValues: [], conflictNote: null };
}

// --- Matching ------------------------------------------------------------------

interface ParsedPrefs {
  accepted: SizeValue[];
  review: SizeValue[];
  neck: number[];
  sleeve: number[];
  acceptedLabel: string;
}

export function parsePrefs(prefs: SizePrefs): ParsedPrefs {
  const accepted = dedupeValues(prefs.accepted.flatMap((s) => parseSizeText(s)));
  const review = dedupeValues(prefs.review.flatMap((s) => parseSizeText(s)));
  const neck = prefs.neck.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const sleeve = prefs.sleeve.flatMap((s) => s.split(/[\/-]/)).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return {
    accepted,
    review,
    neck,
    sleeve,
    acceptedLabel: accepted.length ? joinHuman(accepted.map(sizeLongName), "or") : "none set",
  };
}

function sameValue(a: SizeValue, b: SizeValue): boolean {
  return sizeKey(a) === sizeKey(b);
}

type Verdict = { state: "match" | "review" | "no_match"; why: string };

function judgeValue(v: SizeValue, p: ParsedPrefs, system: SizeSystem, noun: string): Verdict {
  const acceptedTailoredChests = p.accepted.filter((a) => a.kind === "tailored" && a.system === "US").map((a) => (a as { chest: number }).chest);
  if (p.accepted.some((a) => sameValue(a, v))) return { state: "match", why: `${sizeLongName(v)} ${noun} size` };
  if (p.review.some((a) => sameValue(a, v))) {
    return { state: "review", why: `${noun} is listed as ${sizeKey(v)}, which you marked as a size to review (accepted: ${p.acceptedLabel})` };
  }
  switch (v.kind) {
    case "alpha": {
      const regular = p.accepted.find((a) => a.kind === "alpha" && a.base === v.base && !a.tall);
      if (v.tall && regular) {
        return { state: "no_match", why: `${noun} is ${sizeLongName(v)} (${sizeKey(v)}), which is not the same as ${sizeKey(regular)}` };
      }
      if (system === "tailored" && acceptedTailoredChests.length) {
        return {
          state: "no_match",
          why: `${noun} is listed as ${sizeKey(v)}; your accepted size is ${p.acceptedLabel} (letter sizes are not converted to tailored sizes)`,
        };
      }
      return { state: "no_match", why: `${noun} is size ${sizeKey(v)}; your accepted sizes are ${p.acceptedLabel}` };
    }
    case "tailored": {
      const usChest = v.system === "EU" ? v.chest - 10 : v.chest;
      if (v.system === "EU") {
        if (acceptedTailoredChests.includes(usChest)) {
          return {
            state: "review",
            why: `${noun} is EU/IT ${v.chest}, which usually corresponds to US ${usChest}${v.length ? v.length : ""}${v.length ? "" : " (length not stated)"}`,
          };
        }
        return { state: "no_match", why: `${noun} is EU/IT ${v.chest} (≈ US ${usChest}); your accepted size is ${p.acceptedLabel}` };
      }
      if (acceptedTailoredChests.includes(v.chest)) {
        if (v.length === null) {
          return { state: "review", why: `${noun} is size ${v.chest} without a length (Short/Regular/Long); accepted: ${p.acceptedLabel}` };
        }
        return { state: "no_match", why: `${noun} is size ${sizeKey(v)}, your accepted size is ${p.acceptedLabel}` };
      }
      if (system !== "tailored") {
        return { state: "review", why: `${noun} uses tailored sizing (${sizeKey(v)}); your accepted sizes are ${p.acceptedLabel}` };
      }
      return { state: "no_match", why: `${noun} is size ${sizeKey(v)}, your accepted size is ${p.acceptedLabel}` };
    }
    case "neck": {
      if (p.neck.length === 0) {
        return { state: "review", why: `${noun} uses neck/sleeve sizing (${sizeKey(v)}) and you haven't set accepted neck sizes` };
      }
      if (!p.neck.includes(v.neck)) {
        return { state: "no_match", why: `neck size ${formatNum(v.neck)} doesn't match your accepted neck size ${p.neck.join(" or ")}` };
      }
      if (p.sleeve.length === 0) return { state: "match", why: `${formatNum(v.neck)} neck ${noun} size` };
      if (v.sleeves.length === 0) return { state: "review", why: `neck ${formatNum(v.neck)} matches but sleeve length isn't stated` };
      if (v.sleeves.some((s) => p.sleeve.includes(s))) return { state: "match", why: `${sizeKey(v)} ${noun} size` };
      return { state: "no_match", why: `sleeve ${v.sleeves.join("/")} doesn't match your accepted sleeve ${p.sleeve.join("/")}` };
    }
    case "numeric": {
      if (system === "tailored") {
        const readings: string[] = [];
        let possible = false;
        if (acceptedTailoredChests.includes(v.value)) {
          possible = true;
          readings.push(`US ${v.value} without a length`);
        }
        if (v.value >= 44 && v.value <= 62 && acceptedTailoredChests.includes(v.value - 10)) {
          possible = true;
          readings.push(`EU ${v.value} ≈ US ${v.value - 10}`);
        }
        if (possible) return { state: "review", why: `${noun} is listed as “${v.value}” (could be ${joinHuman(readings, "or")})` };
        return { state: "no_match", why: `${noun} is size ${v.value}; your accepted size is ${p.acceptedLabel}` };
      }
      return { state: "review", why: `${noun} has numeric size ${v.value}, which isn't converted to letter sizes automatically` };
    }
    case "other":
      return { state: "review", why: `${noun} size “${v.text}” can't be compared automatically` };
  }
}

export function evaluateSize(reading: SizeReading, prefs: SizePrefs, system: SizeSystem, noun: string): SizeEvaluation {
  const p = parsePrefs(prefs);
  if (reading.values.length === 0) {
    return { state: "review", message: `Size not stated (accepted: ${p.acceptedLabel})`, label: null };
  }
  const label = reading.values.map(sizeKey).join(" / ");
  if (p.accepted.length === 0 && p.neck.length === 0) {
    return { state: "review", message: `No accepted sizes are set for this category (listing: ${label})`, label };
  }
  const verdicts = reading.values.map((v) => judgeValue(v, p, system, noun));
  let state: SizeEvaluation["state"];
  if (verdicts.every((v) => v.state === "match")) state = "match";
  else if (verdicts.some((v) => v.state !== "no_match")) state = "review";
  else state = "no_match";

  let message: string;
  if (reading.values.length > 1 && state === "review" && verdicts.some((v) => v.state === "match")) {
    message = `Listing gives several sizes (${label}); only some are accepted`;
  } else {
    const relevant = verdicts.find((v) => v.state === state) ?? verdicts[0];
    message = relevant.why;
  }
  if (reading.conflictNote) {
    const titleStates = reading.titleValues.map((v) => judgeValue(v, p, system, noun).state);
    const anyPossible = state !== "no_match" || titleStates.some((t) => t !== "no_match");
    if (anyPossible) return { state: "review", message: reading.conflictNote, label };
  }
  if (reading.source === "title" && state === "match") message += " (size read from title)";
  return { state, message, label };
}

export { ALPHA_ORDER };
