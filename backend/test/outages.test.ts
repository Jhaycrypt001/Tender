import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { PriceBook } from "../src/aurora/prices.js";
import { healthRoutes } from "../src/routes/health.js";

/** What Tender does when something it depends on is down or slow. */

describe("a Redis that never answers", () => {
  it("makes /health answer 503 promptly instead of hanging", async () => {
    const app = Fastify();
    const db = { $queryRaw: async () => 1 };
    const redis = { ping: () => new Promise<string>(() => {}) };
    healthRoutes(app, { db, redis } as unknown as Parameters<typeof healthRoutes>[1]);

    const started = Date.now();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ database: "ok", redis: "down" });
    expect(Date.now() - started).toBeLessThan(5_000);
    await app.close();
  });
});

describe("PriceBook while Aurora's token list is failing", () => {
  it("asks Aurora once per minute, not once per lookup", async () => {
    const tokens = vi.fn(async () => {
      throw new Error("aurora down");
    });
    const prices = new PriceBook({ tokens } as never);

    for (let i = 0; i < 5; i++) await expect(prices.usd("base-0xabc.omft.near")).rejects.toThrow("aurora down");
    expect(tokens).toHaveBeenCalledTimes(1);
  });
});
