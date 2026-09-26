import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, signWebhook, verifyApiKey, verifyWebhook } from "../src/lib/crypto.js";
import { checkoutToken, eventId, invoiceId } from "../src/lib/ids.js";

/** Verbatim from the snippet published at /docs, which merchants copy. */
function publishedVerify(rawBody: string, header: string, secret: string) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

describe("webhook signing", () => {
  const body = JSON.stringify({ id: "evt_1", type: "invoice.settled" });
  const secret = "whsec_test";

  it("produces signatures the published /docs snippet accepts", () => {
    expect(publishedVerify(body, signWebhook(body, secret), secret)).toBe(true);
  });

  it("rejects a tampered body, wrong secret, or malformed header", () => {
    const sig = signWebhook(body, secret);
    expect(verifyWebhook(body + " ", sig, secret)).toBe(false);
    expect(verifyWebhook(body, sig, "whsec_other")).toBe(false);
    expect(verifyWebhook(body, "sha256=short", secret)).toBe(false);
    expect(verifyWebhook(body, sig, secret)).toBe(true);
  });
});

describe("merchant API keys", () => {
  it("verifies only the original key against its hash", async () => {
    const key = generateApiKey();
    const hash = await hashApiKey(key);
    expect(hash).not.toContain(key);
    expect(await verifyApiKey(hash, key)).toBe(true);
    expect(await verifyApiKey(hash, generateApiKey())).toBe(false);
    expect(await verifyApiKey("not-a-hash", key)).toBe(false);
  });
});

describe("ids", () => {
  it("prefixes and sizes", () => {
    expect(invoiceId()).toMatch(/^inv_[0-9A-Za-z]{17}$/);
    expect(eventId()).toMatch(/^evt_[0-9A-Za-z]{17}$/);
    // 27 base62 chars ≈ 160 bits; the spec requires at least 128.
    expect(checkoutToken()).toMatch(/^chk_[0-9A-Za-z]{27}$/);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 10_000 }, checkoutToken));
    expect(tokens.size).toBe(10_000);
  });
});
