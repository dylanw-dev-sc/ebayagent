/**
 * Money handling in integer minor units (cents). No floating point is used
 * for any monetary arithmetic or comparison.
 *
 * Percentages are stored as integer basis points (1% = 100 bps) so that
 * "Maximum Secondhand Price = Reference Retail × Allowed %" can be compared
 * exactly: total ≤ retail × bps / 10000  ⇔  total × 10000 ≤ retail × bps.
 */

export const DEFAULT_CURRENCY = "USD";

/** Currencies with 2 decimal minor units that this app understands. */
const TWO_DECIMAL_CURRENCIES = new Set(["USD", "EUR", "GBP", "CAD", "AUD", "CHF"]);

export function minorUnitDigits(currency: string): number {
  if (currency === "JPY") return 0;
  if (TWO_DECIMAL_CURRENCIES.has(currency)) return 2;
  return 2;
}

/**
 * Parse a decimal amount string (as returned by eBay, e.g. "65.00", or typed
 * by the user, e.g. "1,250.5" or "$80") into integer minor units.
 * Returns null for empty / invalid input. Never uses float multiplication.
 */
export function parseMoneyToMinor(input: string | number | null | undefined, currency = DEFAULT_CURRENCY): number | null {
  if (input === null || input === undefined) return null;
  let s = typeof input === "number" ? numberToPlainString(input) : input;
  s = s.trim().replace(/[$€£\s]/g, "").replace(/,/g, "");
  if (s === "") return null;
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const digits = minorUnitDigits(currency);
  const negative = m[1] === "-";
  const whole = m[2];
  const frac = m[3] ?? "";
  if (frac.length > digits) {
    // Round half-up on the first dropped digit, deterministic and exact.
    const kept = frac.slice(0, digits).padEnd(digits, "0");
    const nextDigit = Number(frac[digits]);
    let minor = Number(whole) * 10 ** digits + Number(kept || "0");
    if (nextDigit >= 5) minor += 1;
    return negative ? -minor : minor;
  }
  const minor = Number(whole) * 10 ** digits + Number((frac || "").padEnd(digits, "0") || "0");
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) return "";
  // toFixed(6) avoids exponent notation for typical prices; parse handles rounding.
  return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatMoney(minor: number | null | undefined, currency = DEFAULT_CURRENCY, opts: { compact?: boolean } = {}): string {
  if (minor === null || minor === undefined) return "—";
  const digits = minorUnitDigits(currency);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** digits);
  const frac = abs % 10 ** digits;
  const wholeStr = whole.toLocaleString("en-US");
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : `${currency} `;
  const fracStr = digits > 0 ? `.${String(frac).padStart(digits, "0")}` : "";
  const body = opts.compact && frac === 0 ? wholeStr : `${wholeStr}${fracStr}`;
  return `${negative ? "-" : ""}${symbol}${body}`;
}

/** Minor units → plain decimal string for form inputs ("80.00"). */
export function minorToInput(minor: number | null | undefined, currency = DEFAULT_CURRENCY): string {
  if (minor === null || minor === undefined) return "";
  const digits = minorUnitDigits(currency);
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** digits);
  const frac = abs % 10 ** digits;
  return `${minor < 0 ? "-" : ""}${whole}${digits ? "." + String(frac).padStart(digits, "0") : ""}`;
}

/** Parse "40", "40%", "37.5" into basis points (4000, 4000, 3750). */
export function parsePercentToBps(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/%$/, "").trim();
  if (s === "") return null;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bps;
}

export function formatBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "—";
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}

/**
 * Maximum secondhand price, rounded DOWN to the minor unit for display.
 * Rounding down keeps the displayed ceiling consistent with the exact
 * comparison in `isWithinCeiling` (anything ≤ displayed value passes).
 */
export function computeCeilingMinor(retailMinor: number, allowedBps: number): number {
  const product = retailMinor * allowedBps; // exact: both are safe integers
  return (product - (product % 10000)) / 10000;
}

/** Exact integer comparison: total ≤ retail × bps / 10000. */
export function isWithinCeiling(totalMinor: number, retailMinor: number, allowedBps: number): boolean {
  return totalMinor * 10000 <= retailMinor * allowedBps;
}
