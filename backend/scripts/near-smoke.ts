/**
 * Live check against the real NEAR Intents (1Click) API. Moves no money.
 *
 *   npm run near:smoke -- <near-account> <monad-wallet-address> [amount]
 *
 * It runs the same code a NEAR payout runs, against the live API:
 * 1. Lists the tokens and finds Monad USDC and NEAR USDC.
 * 2. A dry quote: is the route taken, and what would the recipient get?
 * 3. A real quote: the one-off Monad deposit address a payout would be signed to. Nothing is sent to it.
 *
 * The wallet address is only where a refund would go. NEAR_INTENTS_API_KEY is optional.
 */
import { NearIntentsClient } from "../src/near/client.js";
import { nearRoutes } from "../src/near/route.js";
import { TOKENS } from "../src/lib/tokens.js";
import { checkRoute, mintRoute } from "../src/services/payout-route.js";

try {
  process.loadEnvFile();
} catch {}

const [account, wallet, amount = "5"] = process.argv.slice(2);
if (!account || !wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
  console.error("usage: npm run near:smoke -- <near-account> <monad-wallet-address> [amount]");
  process.exit(1);
}

const client = new NearIntentsClient({
  baseUrl: process.env.NEAR_INTENTS_API_URL,
  apiKey: process.env.NEAR_INTENTS_API_KEY || undefined,
  logger: { debug() {}, info: (o, m) => console.log(`  [${m}]`, JSON.stringify({ depositAddress: (o as { depositAddress?: string }).depositAddress, correlationId: (o as { correlationId?: string }).correlationId })), warn: (o, m) => console.warn(`  [${m}]`, JSON.stringify(o)) },
});
const route = nearRoutes(client);

const tokens = await route.tokens();
const pick = (chain: string) => tokens.find((t) => t.blockchain === chain && t.symbol === "USDC");
console.log(`tokens: ${tokens.length} total`);
console.log(`  Monad USDC ${pick("monad")?.assetId ?? "MISSING"}`);
console.log(`  NEAR  USDC ${pick("near")?.assetId ?? "MISSING"}`);

const token = TOKENS.USDC!;
const checked = await checkRoute(route, { chainId: "near", to: account, amount, from: wallet, token });
if (!checked.ok) {
  console.error(`route refused (${checked.field}): ${checked.message}`);
  process.exit(2);
}
console.log(`dry quote: send ${amount} USDC, ${account} receives about ${checked.expectedOut} ${checked.destination.symbol}, in about ${checked.seconds}s`);

const minted = await mintRoute(route, checked, account, { amount, from: wallet });
console.log(`deposit address (nothing sent to it): ${minted.address}`);
