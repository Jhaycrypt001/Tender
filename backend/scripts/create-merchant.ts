/**
 * Operator bootstrap: creates a merchant and prints its API key ONCE.
 *
 *   npm run merchant:create -- --name "Acme" --email ops@acme.com \
 *     --settlement 0xYourMonadAddress [--verified]
 *
 * `--verified` is an operator attestation that you control the settlement
 * address. Use it only for an address you own; merchants signing up through
 * the product prove control with the signature challenge instead (§8).
 *
 * The printed key is for a merchant's own server (Bearer tk_live_…). The dashboard
 * uses TENDER_PLATFORM_KEY instead. The key cannot be shown
 * again — only its hash is stored.
 */
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { createMerchant } from "../src/services/merchant.service.js";

try {
  process.loadEnvFile();
} catch {}

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    email: { type: "string" },
    settlement: { type: "string" },
    asset: { type: "string", default: "USDC" },
    verified: { type: "boolean", default: false },
  },
});

if (!values.name || !values.email) {
  console.error('usage: npm run merchant:create -- --name "Acme" --email ops@acme.com --settlement 0x… [--verified]');
  process.exit(1);
}
if (values.settlement && !/^0x[0-9a-fA-F]{40}$/.test(values.settlement)) {
  console.error("--settlement must be an EVM address (0x + 40 hex characters)");
  process.exit(1);
}

const db = createDb(loadConfig().DATABASE_URL);
try {
  const { merchant, apiKey } = await createMerchant(db, {
    name: values.name,
    email: values.email,
    settlementAddress: values.settlement,
    settlementAsset: values.asset,
    settlementVerified: values.verified,
  });
  console.log(`merchant   ${merchant.id}  (${merchant.name}, ${merchant.email})`);
  console.log(`settlement ${merchant.settlementAddress ?? "not set"}  ${merchant.settlementAsset} on Monad  verified=${merchant.settlementVerified}`);
  console.log(`\nAPI key (shown once — store it now):\n\n  ${apiKey}\n`);
} finally {
  await db.$disconnect();
}
