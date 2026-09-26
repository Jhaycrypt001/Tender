/**
 * Live check against the real Aurora API. Moves no money.
 *
 *   npm run aurora:smoke -- <monad-recipient-address> [sender]
 *
 * 1. Lists tokens and prints the settlement assets available on Monad.
 * 2. Mints one deposit address per chain family, paying out USDC on Monad.
 * 3. Reads all three deposit lists for each address.
 *
 * Re-running with the same sender returns the same addresses
 * (`alreadyExists: true`) — minting is idempotent on its inputs.
 */
import { AuroraClient } from "../src/aurora/client.js";
import { CHAINS, SETTLEMENT_CHAIN } from "../src/aurora/chains.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/lib/logger.js";

try {
  process.loadEnvFile();
} catch {}

const [recipient, sender = "tender-smoke-001"] = process.argv.slice(2);
if (!recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
  console.error("usage: npm run aurora:smoke -- <monad-recipient-address> [sender]");
  process.exit(1);
}

const config = loadConfig();
const aurora = new AuroraClient({
  baseUrl: config.AURORA_API_URL,
  apiKey: config.AURORA_API_KEY,
  logger: createLogger("warn", true),
});

const tokens = await aurora.tokens();
const monad = tokens.filter((t) => t.blockchain === SETTLEMENT_CHAIN);
console.log(`tokens: ${tokens.length} total, ${monad.length} on Monad`);
for (const t of monad) console.log(`  ${t.symbol.padEnd(6)} ${t.decimals}dp  ${t.assetId}`);

const families = [...new Set(CHAINS.map((c) => c.family))];
console.log(`\nminting for sender "${sender}" → USDC on Monad at ${recipient}`);

for (const family of families) {
  const minted = await aurora.mintAddress({
    recipient,
    sender,
    depositChain: family,
    destinationChain: SETTLEMENT_CHAIN,
    destinationAsset: "USDC",
  });
  const lists = await Promise.all(
    (["received", "success", "failed"] as const).map(async (type) => `${type}=${(await aurora.deposits(minted.depositAddress, type)).length}`),
  );
  const chains = CHAINS.filter((c) => c.family === family).map((c) => c.id).join(",");
  console.log(`  ${family.padEnd(5)} ${minted.depositAddress}  existed=${minted.alreadyExists}  [${lists.join(" ")}]  (${chains})`);
}
