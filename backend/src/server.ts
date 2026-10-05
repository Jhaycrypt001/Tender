import { Redis } from "ioredis";
import { createPublicClient, defineChain, http } from "viem";
import { buildApp } from "./app.js";
import { AuroraClient } from "./aurora/client.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { createLogger } from "./lib/logger.js";
import { ChainCatalogueReader } from "./services/chains.service.js";
import { createTransferChain } from "./services/transfer-chain.js";
import { InvoiceStream } from "./services/stream.js";

try {
  process.loadEnvFile();
} catch {
  // No .env file: real environments set variables directly.
}

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
await redis.connect();
// A subscribed Redis connection can do nothing else, so SSE gets its own.
const subscriber = redis.duplicate();
const stream = new InvoiceStream(subscriber);

const aurora = new AuroraClient({
  baseUrl: config.AURORA_API_URL,
  apiKey: config.AURORA_API_KEY,
  logger: createLogger(config.LOG_LEVEL, config.NODE_ENV === "development").child({ component: "aurora" }),
});

const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [config.MONAD_RPC_URL] } },
});
const chain = createPublicClient({ chain: monad, transport: http(config.MONAD_RPC_URL, { timeout: 10_000 }) });

const transferChain = createTransferChain({ client: chain, rpcUrl: config.MONAD_RPC_URL, relayerKey: config.RELAYER_PRIVATE_KEY as `0x${string}` | undefined });
const app = await buildApp({ config, db, redis, aurora, stream, catalogue: new ChainCatalogueReader(redis), chain, transferChain });

// Graceful shutdown: stop taking requests, then close connections. A second
// signal forces exit.
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (closing) process.exit(1);
    closing = true;
    app.log.info({ signal }, "shutting down");
    await app.close();
    await Promise.allSettled([db.$disconnect(), redis.quit(), subscriber.quit()]);
    process.exit(0);
  });
}

await app.listen({ port: config.PORT, host: "0.0.0.0" });
