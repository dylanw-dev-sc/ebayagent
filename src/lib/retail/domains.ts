/**
 * Stores whose prices aren't "new at retail": resale and marketplace sites,
 * aggregators and social sites. Editable in the Cost page settings.
 */
export const DEFAULT_BLOCKED_DOMAINS = [
  "ebay.com",
  "grailed.com",
  "poshmark.com",
  "therealreal.com",
  "vestiairecollective.com",
  "depop.com",
  "mercari.com",
  "thredup.com",
  "fashionphile.com",
  "rebag.com",
  "etsy.com",
  "amazon.com",
  "walmart.com",
  "stockx.com",
  "goat.com",
  "lyst.com",
  "shopstyle.com",
  "google.com",
  "pinterest.com",
  "reddit.com",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
];

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

/** Blocked when the host is a listed domain or a subdomain of one; any eBay site is always blocked. */
export function isBlockedHost(host: string, blocked: string[]): boolean {
  if (/(^|\.)ebay\.[a-z.]+$/.test(host)) return true;
  return blocked.some((d) => {
    const domain = d.trim().toLowerCase().replace(/^www\./, "");
    return domain !== "" && (host === domain || host.endsWith(`.${domain}`));
  });
}
