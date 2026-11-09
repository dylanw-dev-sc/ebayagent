import type { FeedFilters, FeedSort, FeedView, PricingFilter } from "@/server/services/feed";

export type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const posInt = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

const VIEWS: FeedView[] = ["matches", "review", "excluded", "all", "saved", "dismissed"];
const SORTS: FeedSort[] = ["newest", "price_asc", "price_desc", "material"];
const PRICING: PricingFilter[] = ["eligible", "over_ceiling", "needs_review"];

export const PAGE_SIZE = 40;

export function parseFeedParams(sp: SearchParams, defaults: { view?: FeedView } = {}): FeedFilters {
  const view = first(sp.view) as FeedView;
  const sort = first(sp.sort) as FeedSort;
  const pricing = first(sp.price) as PricingFilter;
  const rev = first(sp.rev);
  return {
    view: VIEWS.includes(view) ? view : defaults.view ?? "matches",
    brandId: posInt(first(sp.brand)),
    categoryId: posInt(first(sp.cat)),
    size: first(sp.size) || undefined,
    material: first(sp.mat) || undefined,
    pricing: PRICING.includes(pricing) ? pricing : undefined,
    review: rev === "reviewed" || rev === "unreviewed" ? rev : undefined,
    profileId: posInt(first(sp.profile)),
    q: first(sp.q) || undefined,
    newOnly: first(sp.new) === "1",
    sort: SORTS.includes(sort) ? sort : "newest",
    page: posInt(first(sp.page)) ?? 1,
    pageSize: PAGE_SIZE,
  };
}

/** Build a URL from current params with some keys replaced/removed (null/"" removes). */
export function hrefWith(base: string, sp: SearchParams, patch: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = first(v);
    if (val !== undefined && val !== "") params.set(k, val);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") params.delete(k);
    else params.set(k, String(v));
  }
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}
