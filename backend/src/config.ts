import { z } from "zod";

/**
 * Every setting the API reads, parsed once at startup.
 *
 * The server refuses to boot on a missing or malformed value rather than
 * failing later mid-request. Local defaults match docker-compose.yml, so a
 * fresh clone needs only AURORA_API_KEY in `.env`.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.url().default("postgresql://tender:tender@localhost:5434/tender"),
  REDIS_URL: z.url().default("redis://localhost:6379"),

  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),

  AURORA_API_URL: z.url().default("https://intents-api.aurora.dev"),
  AURORA_API_KEY: z.string().min(1, "AURORA_API_KEY is required — create one at https://studio.aurora.dev"),

  /** How often an open invoice's addresses are polled. Aurora throttles our key, so not faster than this. */
  POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(10_000),
  /** How often a closed invoice's addresses are polled (late-payment watch). */
  POLL_CLOSED_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
  INVOICE_TTL_MINUTES: z.coerce.number().int().positive().default(30),

  /** A payment within this many basis points of the amount counts as exact. Absorbs price-feed lag. */
  PAYMENT_TOLERANCE_BPS: z.coerce.number().int().min(0).max(1000).default(100),
  /** After an invoice's deadline, how long a deposit that is already in flight still counts. */
  EXPIRY_GRACE_MINUTES: z.coerce.number().int().min(0).default(15),
  /** How long a closed invoice's addresses are still watched for late or extra money. */
  LATE_WINDOW_HOURS: z.coerce.number().int().min(0).default(24),
  POLL_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  POLL_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(200),

  /** Monad RPC, used only to verify smart-contract settlement wallets (ERC-1271). */
  MONAD_RPC_URL: z.url().default("https://rpc.monad.xyz"),

  /**
   * Lets the dashboard's server act for one merchant at a time (see
   * docs/INTEGRATION.md §1). Unset disables the platform path entirely.
   * It can act as ANY merchant: keep it in the API env and the dashboard's
   * server env only, never in a browser bundle.
   */
  TENDER_PLATFORM_KEY: z
    .string()
    .regex(/^tp_[A-Za-z0-9_-]{43,}$/, "must be tp_ followed by at least 43 URL-safe characters (32 random bytes, base64url)")
    .optional(),

  /**
   * Welcome email through Resend. Optional: with no key nothing is queued and
   * sign-in is unaffected. API and worker both read these; only the worker sends.
   */
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).default("Tender <hello@tenderr.xyz>"),
  /** tenderr.xyz can send but not receive, so set this to a mailbox someone reads. Unset: no reply-to is sent. */
  EMAIL_REPLY_TO: z.string().min(3).optional(),
  /** Public origin of the dashboard, used for the links inside emails. */
  APP_URL: z.url().default("https://tenderr.xyz").transform((u) => u.replace(/\/+$/, "")),

  /**
   * The Ask assistant (docs/ASSISTANT.md). Optional: with no key the route is
   * not registered at all, so the dashboard shows its honest "not connected" reply.
   * Backend env only. Never on Vercel, never NEXT_PUBLIC_.
   */
  GEMINI_API_KEY: z.string().min(1).optional(),
  ASSISTANT_MODEL: z.string().min(1).default("gemini-3.1-flash-lite"),
  /** Tried once when the main model is overloaded (429/5xx). Empty disables the fallback. */
  ASSISTANT_FALLBACK_MODEL: z.string().default("gemini-3.5-flash-lite"),

  /** If set, GET /metrics requires `Authorization: Bearer <token>`. */
  METRICS_TOKEN: z.string().min(16).optional(),
  /** Port for the worker process's own /metrics endpoint. */
  WORKER_METRICS_PORT: z.coerce.number().int().positive().default(9464),

  /** How often the worker re-measures per-chain minimums from Aurora. */
  MINIMUMS_REFRESH_MINUTES: z.coerce.number().int().min(5).default(30),
  /** Safety margin added to each measured minimum: fees move between measurements. */
  MINIMUM_MARGIN_BPS: z.coerce.number().int().min(0).max(10_000).default(2000),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
