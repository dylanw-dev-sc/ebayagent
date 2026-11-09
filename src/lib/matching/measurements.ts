/**
 * Garment measurements ("pit to pit 23 in", "length 30", "shoulders 46 cm")
 * read from listing text, and compared with the user's own fit ranges.
 *
 * All values are FLAT garment measurements in inches. Centimetres are
 * converted; a "chest" figure that is clearly a circumference is halved.
 * Values that don't look plausible for the measurement are ignored rather
 * than guessed.
 */

export type MeasurementKey = "chest" | "length" | "shoulders" | "sleeve";
export const MEASUREMENT_KEYS: MeasurementKey[] = ["chest", "shoulders", "length", "sleeve"];

export const MEASUREMENT_LABEL: Record<MeasurementKey, string> = {
  chest: "pit to pit",
  shoulders: "shoulders",
  length: "length",
  sleeve: "sleeve",
};

export interface MeasurementRange {
  min: number | null;
  max: number | null;
}

export type MeasurementRanges = Partial<Record<MeasurementKey, MeasurementRange>>;

export interface MeasurementFound {
  key: MeasurementKey;
  /** Flat measurement in inches, rounded to 0.1. */
  inches: number;
  raw: string;
  note: string | null;
}

export interface MeasurementReading {
  values: Partial<Record<MeasurementKey, number>>;
  found: MeasurementFound[];
}

/** Plausible flat measurements for adult menswear, in inches. */
const PLAUSIBLE: Record<MeasurementKey, [number, number]> = {
  chest: [16, 34],
  length: [20, 40],
  shoulders: [13, 24],
  sleeve: [18, 30],
};

const LABELS: Array<{ key: MeasurementKey | "chest_generic"; re: string }> = [
  // Order matters: longer / more specific labels first; matched spans are masked.
  { key: "sleeve", re: "sleeve length|sleeves?|shoulder (?:seam )?to cuff" },
  { key: "shoulders", re: "shoulder to shoulder|across (?:the )?shoulders|shoulders?(?: seam to seam)?" },
  {
    key: "chest",
    re: "pit to pit|pit 2 pit|p2p|ptp|armpit to armpit|arm pit to arm pit|underarm to underarm|across (?:the )?chest|chest (?:laid )?flat",
  },
  { key: "length", re: "back length|body length|total length|collar to hem|top to bottom|length" },
  { key: "chest_generic", re: "chest" },
];

const NUM = "(\\d{1,3}(?:\\.\\d{1,2})?)";
const UNIT = "(inches|inch|in\\b|\"|cm\\b|centimeters|centimetres)?";

function prep(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”″]/g, '"')
    .replace(/(\d)\s*½/g, "$1.5")
    .replace(/(\d+)\s+1\/2\b/g, "$1.5")
    .replace(/(\d+)\s+1\/4\b/g, "$1.25")
    .replace(/(\d+)\s+3\/4\b/g, "$1.75")
    .replace(/(?<=[a-z])-(?=[a-z])/g, " ") // pit-to-pit → pit to pit
    .replace(/[–—]/g, "-")
    .replace(/[ \t]+/g, " ");
}

function toInches(value: number, unit: string | undefined, key: MeasurementKey | "chest_generic"): { inches: number; note: string | null } | null {
  const plausibleKey: MeasurementKey = key === "chest_generic" ? "chest" : key;
  const [lo, hi] = PLAUSIBLE[plausibleKey];
  const isCm = !!unit && unit.startsWith("c");
  const isIn = !!unit && !isCm;
  let inches = isCm ? value / 2.54 : value;
  let note: string | null = isCm ? `${value} cm` : null;
  if (key === "chest_generic" && inches > hi && inches >= lo * 2 && inches <= hi * 2) {
    // "Chest 46" is usually the circumference; flat measurements are half that.
    note = `${note ? note + ", " : ""}chest ${value}${isCm ? " cm" : ""} read as a circumference`;
    inches = inches / 2;
  }
  if (inches >= lo && inches <= hi) return { inches: Math.round(inches * 10) / 10, note };
  if (!isIn && !isCm) {
    // No unit given and implausible in inches: try centimetres.
    const fromCm = value / 2.54;
    if (fromCm >= lo && fromCm <= hi) return { inches: Math.round(fromCm * 10) / 10, note: `${value} read as cm` };
  }
  return null;
}

/** Read measurements from the description (preferred) and title. */
export function readMeasurements(input: { title: string; description: string | null }): MeasurementReading {
  const values: Partial<Record<MeasurementKey, number>> = {};
  const found: MeasurementFound[] = [];

  for (const source of [input.description ?? "", input.title]) {
    if (!source) continue;
    // Sentence by sentence (split before lowercasing so "approx. 23" stays together).
    for (const rawSentence of source.split(/[\n;|]|(?<=[.!?])\s+(?=[A-Z])/)) {
      let masked = prep(rawSentence);
      const centerBack = /\b(center|centre) back\b|\bcb\b|from (?:the )?(?:collar|neck)/.test(masked);
      for (const { key, re } of LABELS) {
        const target: MeasurementKey = key === "chest_generic" ? "chest" : key;
        // "Pit to pit: approx. 23 in" — label first, unit optional.
        const labelFirst = new RegExp(`\\b(?:${re})\\b\\s*(?:\\([^)]*\\)\\s*)?[:=-]?\\s*(?:approx\\.?|approximately|about|~)?\\s*${NUM}\\s*${UNIT}`, "g");
        // "23 in pit to pit" — value first, unit REQUIRED (so a size label like "44 chest" isn't read as a measurement).
        const valueFirst = new RegExp(`${NUM}\\s*(inches|inch|in\\b|"|cm\\b|centimeters|centimetres)\\s*(?:\\b(?:${re})\\b)`, "g");
        for (const pattern of [labelFirst, valueFirst]) {
          let m: RegExpExecArray | null;
          while ((m = pattern.exec(masked))) {
            const end = m.index + m[0].length;
            masked = masked.slice(0, m.index) + " ".repeat(m[0].length) + masked.slice(end);
            pattern.lastIndex = end;
            // Dress-shirt sleeves measured from the center back are a different measurement.
            if (key === "sleeve" && centerBack) continue;
            const conv = toInches(Number(m[1]), m[2], key);
            if (!conv || values[target] !== undefined) continue;
            values[target] = conv.inches;
            found.push({ key: target, inches: conv.inches, raw: m[0].trim(), note: conv.note });
          }
        }
      }
    }
  }
  return { values, found };
}

export type MeasurementVerdict =
  | { verdict: "not_configured" | "inconclusive"; message: null }
  | { verdict: "fits" | "misfit"; message: string };

const fmt = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} in`;

export function describeRange(r: MeasurementRange): string {
  if (r.min !== null && r.max !== null) return `${r.min}–${r.max} in`;
  if (r.min !== null) return `at least ${r.min} in`;
  return `at most ${r.max} in`;
}

export function configuredKeys(ranges: MeasurementRanges | undefined): MeasurementKey[] {
  if (!ranges) return [];
  return MEASUREMENT_KEYS.filter((k) => ranges[k] && (ranges[k]!.min !== null || ranges[k]!.max !== null));
}

/**
 * Compare measurements with the user's ranges. A "fits" verdict needs the
 * chest measurement when a chest range is set; any measured dimension that is
 * out of range makes it a misfit. Unmeasured dimensions are simply unknown.
 */
export function judgeMeasurements(reading: MeasurementReading, ranges: MeasurementRanges | undefined): MeasurementVerdict {
  const keys = configuredKeys(ranges);
  if (keys.length === 0) return { verdict: "not_configured", message: null };
  const checked = keys.filter((k) => reading.values[k] !== undefined);
  for (const k of checked) {
    const v = reading.values[k]!;
    const r = ranges![k]!;
    if (r.min !== null && v < r.min) return { verdict: "misfit", message: `${MEASUREMENT_LABEL[k]} ${fmt(v)} is below your ${describeRange(r)} range` };
    if (r.max !== null && v > r.max) return { verdict: "misfit", message: `${MEASUREMENT_LABEL[k]} ${fmt(v)} is above your ${describeRange(r)} range` };
  }
  const required: MeasurementKey[] = keys.includes("chest") ? ["chest"] : [];
  const enough = required.length ? required.every((k) => checked.includes(k)) : checked.length > 0;
  if (!enough) return { verdict: "inconclusive", message: null };
  return {
    verdict: "fits",
    message: checked.map((k) => `${MEASUREMENT_LABEL[k]} ${fmt(reading.values[k]!)}`).join(", "),
  };
}

export type FitState = "match" | "review" | "no_match";

/**
 * Combine the size-label verdict with the measurement verdict.
 * Measurements settle uncertain labels; a contradiction goes to review.
 */
export function combineSizeAndMeasurements(
  label: { state: FitState; message: string; label: string | null },
  m: MeasurementVerdict,
  noun: string,
): { state: FitState; message: string } {
  if (m.verdict === "not_configured" || m.verdict === "inconclusive") return { state: label.state, message: label.message };
  const labelText = label.label ? `labeled ${label.label}` : "no size label";
  if (m.verdict === "fits") {
    if (label.state === "match") return { state: "match", message: `${label.message}; measurements fit (${m.message})` };
    if (label.state === "review") return { state: "match", message: `${noun} measurements that fit you (${m.message}; ${labelText})` };
    return { state: "review", message: `${noun} is ${labelText}, but its measurements fit your ranges (${m.message})` };
  }
  if (label.state === "match") return { state: "review", message: `${noun} is ${labelText}, but ${m.message}` };
  if (label.state === "review") return { state: "no_match", message: `${noun} ${m.message}` };
  return { state: "no_match", message: `${label.message} (${m.message})` };
}
