/**
 * Runs the real minimums measurement against Aurora and prints the result and
 * how long it took. Moves no money (dry quotes plus idempotent probe
 * addresses) and writes nothing to Redis.
 *
 *   npm run aurora:measure -- <monad-recipient-address> [chain-id ...]
 *
 * Name chain ids to measure only those, e.g. `… 0x… xrp ton`.
 */
import { CHAINS } from "../src/aurora/chains.js";
import { AuroraClient } from "../src/aurora/client.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/lib/logger.js";
import { measureCatalogue } from "../src/services/chains.service.js";

try {
  process.loadEnvFile();
} catch {}

const [recipient, ...only] = process.argv.slice(2);
if (!recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
  console.error("usage: npm run aurora:measure -- <monad-recipient-address> [chain-id ...]");
  process.exit(1);
}
const unknown = only.filter((id) => !CHAINS.some((c) => c.id === id));
if (unknown.length) {
  console.error(`unknown chain id(s): ${unknown.join(", ")}`);
  process.exit(1);
}

const config = loadConfig();
const logger = createLogger("warn", false);
// Same client settings as the worker's quoting client.
const aurora = new AuroraClient({
  baseUrl: config.AURORA_API_URL,
  apiKey: config.AURORA_API_KEY,
  logger,
  timeoutMs: 30_000,
  maxAttempts: 2,
});

const started = Date.now();
const catalogue = await measureCatalogue(aurora, {
  recipient,
  marginBps: config.MINIMUM_MARGIN_BPS,
  logger,
  only: only.length ? only : undefined,
  onProgress: (c) => void process.stdout.write(`\r${c.chains.length} chain(s) measured, ${Math.round((Date.now() - started) / 1000)}s`),
});
const seconds = Math.round((Date.now() - started) / 1000);
console.log(`\n\nmeasured ${catalogue.chains.length} of ${only.length || CHAINS.length} chains in ${seconds}s\n`);
for (const c of catalogue.chains) console.log(`  ${c.id.padEnd(12)} $${c.minimum.padStart(7)}  eta ${String(c.etaSeconds ?? "?").padStart(5)}s  (${c.asset})`);
const missing = CHAINS.filter((c) => (only.length ? only.includes(c.id) : true) && !catalogue.chains.some((m) => m.id === c.id));
if (missing.length) console.log(`\nNOT measured (would be dropped from /public/chains): ${missing.map((c) => c.id).join(", ")}`);
