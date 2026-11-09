import type { ItemAspect, MaterialConfig, MaterialPriority } from "../domain/types";
import { joinHuman, stripAccents, uniq } from "../text";

/**
 * Material / fiber analysis.
 *
 * Distinguishes:
 *  - actual fiber composition ("80% wool 20% cashmere", item specifics "Material: Merino Wool")
 *  - fiber names stated without percentages ("Cashmere Blazer")
 *  - faux materials that must NOT count as the real thing ("faux suede", "vegan leather", "cashmere feel")
 *  - subjective quality claims ("premium", "luxury") which are recorded but never treated as facts
 *  - lining materials, which are ignored for the shell composition
 */

export interface MaterialComponent {
  key: string;
  pct: number | null;
  source: "item_specifics" | "title";
  /** Added by implication (merino → wool), not stated directly. */
  implied?: boolean;
}

export interface MaterialReading {
  status: "composition" | "stated" | "unknown";
  components: MaterialComponent[];
  /** Blend materials (e.g. silk-cotton) whose components are all present. */
  blendKeys: string[];
  fauxDetected: string[];
  liningIgnored: string[];
  claims: string[];
  facts: string[];
}

export interface MaterialAssessment {
  reading: MaterialReading;
  /** Best preference level among significant components/blends. */
  level: MaterialPriority | "unknown";
  /** Ranking score: higher = more preferred. Never a quality rating. */
  score: number;
  heavyAvoid: Array<{ key: string; name: string; pct: number | null; presumed: boolean }>;
  /** Components that hit an "exclude" priority material (at/over threshold). */
  excludedHits: Array<{ key: string; name: string; pct: number | null; presumed: boolean }>;
  summary: string;
  keys: string[];
}

const PRIORITY_VALUE: Record<MaterialPriority, number> = { very_high: 3, high: 2, neutral: 0, avoid: -2, exclude: -3 };
export const PRIORITY_LABEL: Record<MaterialPriority, string> = {
  very_high: "Very high priority",
  high: "High priority",
  neutral: "Neutral",
  avoid: "Generally avoid",
  exclude: "Exclude",
};

const FAUX_BEFORE = new Set(["faux", "vegan", "imitation", "synthetic", "fake", "pu", "eco", "artificial", "simulated", "man", "manmade", "pleather", "bonded"]);
const CLAIM_AFTER = new Set(["feel", "like", "look", "touch", "effect", "style", "type", "inspired", "lookalike", "alike"]);
const LINING_WORDS = new Set(["lining", "lined", "linings", "fodera", "liner"]);
const NEGATION_BEFORE = new Set(["no", "not", "non", "without"]);
const SILK_PRINT_AFTER = new Set(["screen", "screened", "screenprint", "screenprinted", "print", "printed"]);
// Applied to prepped text (hyphens already turned into spaces).
const FAUX_COMPOUNDS: Array<[RegExp, string]> = [
  [/\b(leatherette|pleather|ecopelle|leather look|eco leather)\b/, "leather"],
  [/\b(microsuede|micro suede|ultrasuede|suedette|suede look|suede effect|alcantara)\b/, "suede"],
];

const CLAIM_PATTERNS: RegExp[] = [
  /\bpremium\b/,
  /\bluxur(?:y|ious)\b/,
  /\bhigh[\s-]quality\b/,
  /\btop[\s-]quality\b/,
  /\bbest[\s-]quality\b/,
  /\bfinest\b/,
  /\bexquisite\b/,
  /\b(?:super|ultra)[\s-]soft\b/,
  /\bheavyweight\b/,
];

const FACT_PATTERNS: Array<[RegExp, string]> = [
  [/\bsupima\b/, "Supima cotton (stated)"],
  [/\b(?<!su)pima\b/, "Pima cotton (stated)"],
  [/\begyptian cotton\b/, "Egyptian cotton (stated)"],
  [/\bsea island\b/, "Sea Island cotton (stated)"],
  [/\bgiza\b/, "Giza cotton (stated)"],
  [/\b(?:2|two)[\s-]ply\b/, "Two-ply (stated)"],
  [/\bsuper\s?(1[0-9]0|200)\s?s\b/, "Super $1s wool grade (stated)"],
];

/** Implied fibers: merino is a wool. */
const IMPLIES: Record<string, string[]> = { merino_wool: ["wool"] };

const SEGMENT = "|";

function prepMaterial(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/(\d)\s*%/g, "$1% ")
    .replace(/[,;()\n|]|\.\s/g, ` ${SEGMENT} `)
    .replace(/[^a-z0-9%\s|-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface FiberMatcher {
  key: string;
  phrases: string[][];
}

function compileFibers(materials: MaterialConfig[]): FiberMatcher[] {
  return materials
    .filter((m) => m.kind === "fiber")
    .map((m) => ({
      key: m.key,
      phrases: uniq(m.keywords.map((k) => prepMaterial(k)).filter(Boolean))
        .map((k) => k.split(" "))
        // longest phrases first so "merino wool" wins over "wool"
        .sort((a, b) => b.length - a.length),
    }));
}

interface Hit {
  key: string;
  start: number;
  end: number;
  pct: number | null;
  faux: boolean;
  lining: boolean;
  negated: boolean;
  claimWord: string | null;
}

const isPct = (t: string | undefined) => !!t && /^\d{1,3}%$/.test(t);

function scan(text: string, fibers: FiberMatcher[]): Hit[] {
  const tokens = text.split(" ").filter(Boolean);
  const hits: Hit[] = [];
  const taken = new Set<number>();
  // Candidate spans, longest phrase first across all fibers.
  const candidates: Array<{ key: string; start: number; end: number }> = [];
  for (const f of fibers) {
    for (const phrase of f.phrases) {
      for (let i = 0; i <= tokens.length - phrase.length; i++) {
        let ok = true;
        for (let j = 0; j < phrase.length; j++) {
          if (tokens[i + j] !== phrase[j]) {
            ok = false;
            break;
          }
        }
        if (ok) candidates.push({ key: f.key, start: i, end: i + phrase.length });
      }
    }
  }
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const chosen: Array<{ key: string; start: number; end: number }> = [];
  for (const c of candidates) {
    let overlap = false;
    for (let i = c.start; i < c.end; i++) if (taken.has(i)) overlap = true;
    if (overlap) continue;
    for (let i = c.start; i < c.end; i++) taken.add(i);
    chosen.push(c);
  }
  chosen.sort((a, b) => a.start - b.start);

  // Segment bounds so context never leaks across "," ";" "(" etc.
  const segOf: number[] = [];
  let seg = 0;
  tokens.forEach((t, i) => {
    if (t === SEGMENT) seg++;
    segOf[i] = seg;
  });
  // Percent placement style per segment: "80% wool" (pct first) vs "wool 80%".
  const pctFirst = new Map<number, boolean>();
  for (const c of chosen) {
    const sg = segOf[c.start];
    if (pctFirst.has(sg)) continue;
    const firstPct = tokens.findIndex((t, i) => segOf[i] === sg && isPct(t));
    if (firstPct >= 0) pctFirst.set(sg, firstPct < c.start);
  }

  for (const c of chosen) {
    const sg = segOf[c.start];
    const inSeg = (i: number) => i >= 0 && i < tokens.length && segOf[i] === sg && tokens[i] !== SEGMENT;
    const before1 = inSeg(c.start - 1) ? tokens[c.start - 1] : undefined;
    const before2 = inSeg(c.start - 2) ? tokens[c.start - 2] : undefined;
    const after1 = inSeg(c.end) ? tokens[c.end] : undefined;
    const pctBefore = isPct(before1) ? Number(before1!.slice(0, -1)) : null;
    const pctAfter = isPct(after1) ? Number(after1!.slice(0, -1)) : null;
    const preferBefore = pctFirst.get(sg) ?? true;
    const pct = preferBefore ? pctBefore ?? (pctFirst.has(sg) ? null : pctAfter) : pctAfter ?? (pctFirst.has(sg) ? null : pctBefore);

    // Lining: a lining word within 2 tokens, same segment, no other fiber in between.
    let lining = false;
    for (let i = c.start - 2; i <= c.end + 1; i++) {
      if (i >= c.start && i < c.end) continue;
      if (!inSeg(i) || !LINING_WORDS.has(tokens[i])) continue;
      const lo = Math.min(i, c.start);
      const hi = Math.max(i, c.end - 1);
      const between = chosen.some((o) => o !== c && o.start > lo && o.start < hi);
      if (!between) lining = true;
    }

    const claimWord =
      after1 && CLAIM_AFTER.has(after1) ? after1 : c.key === "silk" && after1 && SILK_PRINT_AFTER.has(after1) ? after1 : null;
    hits.push({
      key: c.key,
      start: c.start,
      end: c.end,
      pct,
      faux: (!!before1 && FAUX_BEFORE.has(before1)) || (before2 === "man" && before1 === "made"),
      lining,
      negated: !!before1 && NEGATION_BEFORE.has(before1),
      claimWord,
    });
  }
  return hits;
}

const MATERIAL_ASPECT_NAMES = ["material", "outer shell material", "shell material", "fabric", "main material", "composition", "fabric content"];

export function readMaterials(
  input: { title: string; materialAspect: string | null; aspects: ItemAspect[] },
  materials: MaterialConfig[],
): MaterialReading {
  const fibers = compileFibers(materials);
  const aspectTexts = uniq(
    [
      input.materialAspect ?? "",
      ...input.aspects.filter((a) => MATERIAL_ASPECT_NAMES.includes(a.name.trim().toLowerCase())).map((a) => a.value),
    ].filter(Boolean),
  );
  const liningAspects = input.aspects.filter((a) => /lining/i.test(a.name)).map((a) => a.value);

  const fauxDetected: string[] = [];
  const liningIgnored: string[] = [];
  const claimPhrases: string[] = [];
  const components: MaterialComponent[] = [];
  const nameOf = (k: string) => materials.find((m) => m.key === k)?.name ?? k;

  const consume = (rawText: string, source: MaterialComponent["source"]) => {
    const text = prepMaterial(rawText);
    for (const [re, label] of FAUX_COMPOUNDS) if (re.test(text)) fauxDetected.push(label);
    for (const hit of scan(text, fibers)) {
      if (hit.negated) continue;
      if (hit.claimWord) {
        claimPhrases.push(`“${nameOf(hit.key).toLowerCase()} ${hit.claimWord}” (not a fiber)`);
        continue;
      }
      if (hit.faux) {
        fauxDetected.push(hit.key);
        continue;
      }
      if (hit.lining) {
        liningIgnored.push(hit.key);
        continue;
      }
      const existing = components.find((c) => c.key === hit.key);
      if (existing) {
        if (existing.pct === null && hit.pct !== null) existing.pct = hit.pct;
        continue;
      }
      components.push({ key: hit.key, pct: hit.pct, source });
    }
  };

  for (const t of aspectTexts) consume(t, "item_specifics");
  for (const t of liningAspects) {
    for (const hit of scan(prepMaterial(t), fibers)) liningIgnored.push(hit.key);
  }
  consume(input.title, "title");

  // Implied fibers (merino → wool) keep the same share.
  for (const c of [...components]) {
    for (const implied of IMPLIES[c.key] ?? []) {
      if (!components.some((x) => x.key === implied)) components.push({ key: implied, pct: c.pct, source: c.source, implied: true });
    }
  }

  const present = new Set(components.map((c) => c.key));
  const blendKeys = materials
    .filter((m) => m.kind === "blend" && m.components.length > 0 && m.components.every((k) => present.has(k)))
    .map((m) => m.key);

  const allText = prepMaterial([input.title, ...aspectTexts].join(" "));
  const claims = uniq([
    ...CLAIM_PATTERNS.map((re) => re.exec(allText)?.[0]).filter((x): x is string => !!x).map((c) => `“${c}”`),
    ...claimPhrases,
  ]);
  const facts = uniq(
    FACT_PATTERNS.flatMap(([re, label]) => {
      const m = re.exec(allText);
      return m ? [label.replace("$1", m[1] ?? "")] : [];
    }),
  );

  const status: MaterialReading["status"] =
    components.length === 0 ? "unknown" : components.some((c) => c.pct !== null) ? "composition" : "stated";

  return {
    status,
    components,
    blendKeys,
    fauxDetected: uniq(fauxDetected),
    liningIgnored: uniq(liningIgnored),
    claims,
    facts,
  };
}

function isHeavy(c: MaterialComponent, threshold: number | null, all: MaterialComponent[]): { heavy: boolean; presumed: boolean } {
  if (threshold === null) return { heavy: true, presumed: false };
  if (c.pct !== null) return { heavy: c.pct >= threshold, presumed: false };
  // Unknown share: presume heavy only if it's the only stated fiber or listed first.
  const explicit = all.filter((x) => !x.implied);
  if (explicit.length === 1 || explicit[0] === c) return { heavy: true, presumed: true };
  return { heavy: false, presumed: true };
}

export function assessMaterials(reading: MaterialReading, materials: MaterialConfig[], excludedKeys?: string[]): MaterialAssessment {
  const byKey = new Map(materials.map((m) => [m.key, m]));
  const nameOf = (k: string) => byKey.get(k)?.name ?? k;
  const excludedSet = new Set(excludedKeys ?? materials.filter((m) => m.priority === "exclude").map((m) => m.key));

  const heavyAvoid: MaterialAssessment["heavyAvoid"] = [];
  const excludedHits: MaterialAssessment["excludedHits"] = [];
  let best: MaterialPriority | null = null;

  for (const c of reading.components) {
    const cfg = byKey.get(c.key);
    if (!cfg) continue;
    const significant = c.pct === null || c.pct >= 20;
    if (excludedSet.has(c.key)) {
      const h = isHeavy(c, cfg.heavyThresholdPct, reading.components);
      if (h.heavy) excludedHits.push({ key: c.key, name: cfg.name, pct: c.pct, presumed: h.presumed });
      continue;
    }
    if (cfg.priority === "avoid") {
      const h = isHeavy(c, cfg.heavyThresholdPct, reading.components);
      if (h.heavy) heavyAvoid.push({ key: c.key, name: cfg.name, pct: c.pct, presumed: h.presumed });
      continue;
    }
    if (significant && (best === null || PRIORITY_VALUE[cfg.priority] > PRIORITY_VALUE[best])) best = cfg.priority;
  }
  for (const k of reading.blendKeys) {
    const cfg = byKey.get(k);
    if (cfg && (best === null || PRIORITY_VALUE[cfg.priority] > PRIORITY_VALUE[best])) best = cfg.priority;
  }

  let score = best ? PRIORITY_VALUE[best] : 0;
  for (const h of heavyAvoid) score -= h.presumed ? 1.5 : 3;
  if (reading.status === "stated") score -= 0.25; // stated without % is slightly less certain

  let level: MaterialAssessment["level"];
  if (reading.status === "unknown") level = "unknown";
  else if (excludedHits.length) level = "exclude";
  else if (heavyAvoid.length) level = "avoid";
  else level = best ?? "neutral";

  const describe = (c: MaterialComponent) => `${c.pct !== null ? c.pct + "% " : ""}${nameOf(c.key)}`;
  const shown = reading.components.filter((c) => !c.implied);
  let summary: string;
  if (reading.status === "unknown") {
    summary = reading.fauxDetected.length
      ? `Faux ${joinHuman(reading.fauxDetected)} only — no genuine fiber composition listed`
      : "No fabric composition provided";
  } else {
    summary = joinHuman(shown.map(describe));
    if (reading.status === "stated") summary += " (stated, no percentages)";
  }

  return {
    reading,
    level,
    score,
    heavyAvoid,
    excludedHits,
    summary,
    keys: uniq([...reading.components.map((c) => c.key), ...reading.blendKeys]),
  };
}
