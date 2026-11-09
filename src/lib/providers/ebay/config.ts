/**
 * eBay configuration from environment variables. Credentials are never stored
 * in the database or sent to the browser.
 */

export type EbayEnvironment = "production" | "sandbox";

export interface EbayConfig {
  clientId: string;
  clientSecret: string;
  environment: EbayEnvironment;
  marketplaceId: string;
  /** Optional US ZIP used for calculated-shipping estimates (X-EBAY-C-ENDUSERCTX). */
  deliveryZip: string | null;
}

export const EBAY_HOSTS: Record<EbayEnvironment, string> = {
  production: "https://api.ebay.com",
  sandbox: "https://api.sandbox.ebay.com",
};

/** Public-data scope used by the Browse API with an application access token. */
export const EBAY_PUBLIC_SCOPE = "https://api.ebay.com/oauth/api_scope";

export function readEbayConfig(env: Record<string, string | undefined> = process.env): EbayConfig | null {
  const clientId = env.EBAY_CLIENT_ID?.trim();
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const environment: EbayEnvironment = env.EBAY_ENVIRONMENT?.trim().toLowerCase() === "sandbox" ? "sandbox" : "production";
  const zip = env.EBAY_DELIVERY_ZIP?.trim();
  return {
    clientId,
    clientSecret,
    environment,
    marketplaceId: env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_US",
    deliveryZip: zip && /^\d{5}$/.test(zip) ? zip : null,
  };
}
