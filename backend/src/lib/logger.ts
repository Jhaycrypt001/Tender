import { pino, type LoggerOptions } from "pino";

/**
 * Structured JSON logs. Secrets are redacted by path so a stray
 * `log.info({ headers })` can never write a merchant key or the Aurora key.
 */
export function loggerOptions(level: string, pretty: boolean): LoggerOptions {
  return {
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "headers.authorization",
        "*.apiKey",
        "*.api_key",
        "*.webhookSecret",
        "*.secret",
      ],
      censor: "[redacted]",
    },
    ...(pretty ? { transport: { target: "pino-pretty", options: { singleLine: true } } } : {}),
  };
}

export function createLogger(level: string, pretty: boolean) {
  return pino(loggerOptions(level, pretty));
}

export type Logger = ReturnType<typeof createLogger>;
