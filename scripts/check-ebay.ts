/**
 * Verify eBay API access with the credentials in .env.local:
 *   npm run ebay:check
 * Mints an application token, makes ONE Browse search call (limit=1) and reads
 * the remaining daily quota from the Developer Analytics API when available.
 */
import { readEbayConfig } from "../src/lib/providers/ebay/config";
import { EbayProvider } from "../src/lib/providers/ebay/provider";
import { getDbHandle } from "../src/server/db/client";
import { saveConnectionCheck } from "../src/server/services/status";

async function main() {
  const config = readEbayConfig();
  if (!config) {
    console.error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set. Copy .env.example to .env.local and fill them in (see README).");
    process.exitCode = 1;
    return;
  }
  console.log(`Checking eBay ${config.environment} access for client id ${config.clientId.slice(0, 6)}…`);
  const check = await new EbayProvider(config, { minIntervalMs: 0 }).checkConnection();
  saveConnectionCheck(getDbHandle().db, check);
  console.log(check.ok ? "OK" : `FAILED (${check.code})`);
  console.log(check.message);
  if (check.remainingCalls !== undefined && check.remainingCalls !== null) console.log(`Remaining Browse calls today: ${check.remainingCalls} of ${check.callLimit ?? "?"}`);
  process.exitCode = check.ok ? 0 : 1;
}

main();
