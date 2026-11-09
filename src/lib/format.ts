import type { MatchState } from "./domain/types";
import { formatMoney } from "./money";
import type { Tone } from "../components/ui";

export function timeAgo(date: Date | string | number | null | undefined, now = Date.now()): string {
  if (date === null || date === undefined) return "—";
  const t = new Date(date).getTime();
  const diff = Math.round((now - t) / 1000);
  if (diff < 0) return "just now";
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86_400 * 14) return `${Math.round(diff / 86_400)} d ago`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(date: Date | string | number | null | undefined): string {
  if (date === null || date === undefined) return "—";
  return new Date(date).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const STATE_LABEL: Record<MatchState, string> = { match: "Match", review: "Needs review", no_match: "Not a match" };
export const STATE_TONE: Record<MatchState, Tone> = { match: "match", review: "review", no_match: "exclude" };

export type PricingStatus = "eligible" | "over_ceiling" | "needs_review";
export const PRICING_LABEL: Record<PricingStatus, string> = {
  eligible: "Within ceiling",
  over_ceiling: "Over ceiling",
  needs_review: "Needs pricing review",
};
export const PRICING_TONE: Record<PricingStatus, Tone> = { eligible: "match", over_ceiling: "exclude", needs_review: "slate" };

export const MATERIAL_LEVEL_LABEL: Record<string, string> = {
  very_high: "Very high priority",
  high: "High priority",
  neutral: "Neutral",
  avoid: "Generally avoid",
  exclude: "Excluded material",
  unknown: "Fabric not stated",
};

export const MATERIAL_LEVEL_TONE: Record<string, Tone> = {
  very_high: "match",
  high: "match",
  neutral: "neutral",
  avoid: "review",
  exclude: "exclude",
  unknown: "neutral",
};

export function shippingText(status: string, shippingMinor: number | null, currency: string | null): string {
  if (status === "free") return "Free shipping";
  if (status === "fixed" && shippingMinor !== null) return `+ ${formatMoney(shippingMinor, currency ?? "USD")} shipping`;
  if (status === "calculated") return "Shipping calculated at checkout";
  return "Shipping unknown";
}

export const SCAN_STATUS_LABEL: Record<string, string> = {
  running: "Running",
  completed: "Completed",
  completed_with_errors: "Completed with errors",
  partial: "Stopped early",
  failed: "Failed",
  interrupted: "Interrupted",
};

export const SCAN_STATUS_TONE: Record<string, Tone> = {
  running: "slate",
  completed: "match",
  completed_with_errors: "review",
  partial: "review",
  failed: "exclude",
  interrupted: "review",
};
