/**
 * Read-only: prints what Aurora's token list says for each chain we serve, and
 * for the chains we are considering. Moves no money.
 *
 *   npm run aurora:tokens              every code in CHAINS plus the candidates below
 *   npm run aurora:tokens -- sol xrp   just these Aurora codes
 *
 * Use it before adding a chain to `aurora/chains.ts`: `measureCatalogue` only
 * finds a chain's asset if a token with EXACTLY that `blockchain` code and
 * `symbol` is listed, and silently drops the chain otherwise. Pick `asset` from
 * this output; never guess it.
 */
import { AuroraClient } from "../src/aurora/client.js";
import { CHAINS } from "../src/aurora/chains.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/lib/logger.js";

try {
  process.loadEnvFile();
} catch {}

/** Aurora `depositChain` codes from the persistent-address spec, beyond what CHAINS already has. */
const CANDIDATES = [
  "op", "pol", "bsc", "avax", "gnosis", "scroll", "bera", "plasma", "xlayer", "adi",
  "near", "sui", "aptos", "ton", "xrp", "cardano", "doge", "ltc", "bch", "zec", "starknet", "aleo", "dash",
];

const config = loadConfig();
const aurora = new AuroraClient({
  baseUrl: config.AURORA_API_URL,
  apiKey: config.AURORA_API_KEY,
  logger: createLogger("warn", false),
});

const wanted = process.argv.slice(2);
const codes = wanted.length ? wanted : [...new Set([...CHAINS.map((c) => c.aurora), ...CANDIDATES])];
const tokens = await aurora.tokens();
const known = new Set(tokens.map((t) => t.blockchain));

for (const code of codes) {
  const here = tokens.filter((t) => t.blockchain === code);
  const ours = CHAINS.find((c) => c.aurora === code);
  console.log(`\n${code}${ours ? `  (ours: ${ours.id}, asset ${ours.asset})` : ""}  ${here.length} token(s)`);
  if (!here.length) {
    const near = [...known].filter((k) => k.includes(code) || code.includes(k));
    console.log(`  none listed under "${code}"${near.length ? `; similar codes: ${near.join(", ")}` : ""}`);
    continue;
  }
  for (const t of here.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    console.log(`  ${t.symbol.padEnd(10)} price=${String(t.price ?? "none").padEnd(12)} decimals=${String(t.decimals).padEnd(3)} ${t.assetId}`);
  }
}
console.log(`\n${tokens.length} tokens across ${known.size} blockchains. All codes: ${[...known].sort().join(", ")}`);
