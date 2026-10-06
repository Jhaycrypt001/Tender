import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PLATFORM_KEY, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";
import { EMAIL_RETRY_MS, EmailWorker } from "../src/workers/email.worker.js";
import { escapeHtml, renderWelcome, sendEmail } from "../src/services/email.service.js";
import { resolveGoogleMerchant } from "../src/services/merchant.service.js";
import { createLogger } from "../src/lib/logger.js";
import { CHAINS } from "../src/aurora/chains.js";

const logger = createLogger("fatal", false);
const cfg = { apiKey: "re_test", from: "Tender <hello@tenderr.xyz>", replyTo: "reply@example.com", appUrl: "https://tenderr.xyz" };
const platform = { authorization: `Bearer ${PLATFORM_KEY}` };

let t: TestContext;
beforeAll(async () => {
  t = await setupApp({ RESEND_API_KEY: "re_test" });
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
});

const merchantRow = { id: "ck123", name: "Ada", settlementAddress: null, settlementVerified: false };

describe("renderWelcome", () => {
  it("shows the Tender mark, served from the app's own origin", () => {
    const m = renderWelcome({ ...merchantRow, appUrl: cfg.appUrl });
    expect(m.html).toContain(`<img src="${cfg.appUrl}/apple-icon.png"`);
    expect(m.html).toContain('alt="Tender"');
  });

  it("escapes a hostile name in the HTML and leaves it readable in the text", () => {
    const m = renderWelcome({ ...merchantRow, name: `<script>alert(1)</script> & "co"`, appUrl: cfg.appUrl });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("&amp;");
    expect(escapeHtml(`a<b>&"'`)).toBe("a&lt;b&gt;&amp;&quot;&#39;");
    expect(m.text).toContain("<script>");
  });

  it("asks for a payout address when none is verified, and says so truthfully", () => {
    const m = renderWelcome({ ...merchantRow, appUrl: cfg.appUrl });
    expect(m.subject).toBe("You're in. Set where your money lands.");
    expect(m.html).toContain("https://tenderr.xyz/app/settings");
    expect(m.html).toContain("Not set yet");
    expect(m.text).toContain(`${CHAINS.length} chains`);
    expect(m.html).toContain(`${CHAINS.length} chains`);
    expect(m.html).not.toContain("31+");
  });

  it("says ready, and points at invoices, once the address is verified", () => {
    const addr = "0x4CAD8fac813f7436Bac414D2C9426363567EFE7f";
    const m = renderWelcome({ ...merchantRow, settlementAddress: addr, settlementVerified: true, appUrl: cfg.appUrl });
    expect(m.subject).toBe("You're in. Take your first payment.");
    expect(m.html).toContain("https://tenderr.xyz/app/checkout/new");
    expect(m.html).not.toContain("Not set yet");
    expect(m.text).toContain(addr);
  });

  it("never carries an API key", () => {
    const m = renderWelcome({ ...merchantRow, appUrl: cfg.appUrl });
    expect(m.html + m.text).not.toMatch(/tk_live_|tp_|whsec_/);
  });
});

describe("sendEmail", () => {
  const message = { subject: "s", html: "<p>h</p>", text: "t" };

  it("posts to Resend with the reply-to and the key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    const r = await sendEmail(cfg, "a@b.co", message, fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, id: "em_1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body as string)).toMatchObject({ to: "a@b.co", reply_to: "reply@example.com", from: cfg.from, text: "t" });
  });

  it("sends no reply_to at all when none is configured", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "em_2" }), { status: 200 }));
    await sendEmail({ ...cfg, replyTo: undefined }, "a@b.co", message, fetchMock as unknown as typeof fetch);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("reply_to");
  });

  it("treats a rejected send as a failure (Resend answers with a body, not an exception)", async () => {
    const rejected = (async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 })) as typeof fetch;
    expect(await sendEmail(cfg, "a@b.co", message, rejected)).toEqual({ ok: false, error: "resend 403: domain not verified" });
  });

  it("treats a network error as a failure", async () => {
    const down = (async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;
    expect(await sendEmail(cfg, "a@b.co", message, down)).toEqual({ ok: false, error: "socket hang up" });
  });
});

describe("queueing the welcome", () => {
  it("queues exactly one welcome on first sign-in and none on the second", async () => {
    const who = { googleSub: "did:privy:abc", email: "ada@example.com", name: "Ada" };
    const first = await resolveGoogleMerchant(t.db, who, { welcomeEmail: true });
    await resolveGoogleMerchant(t.db, who, { welcomeEmail: true });
    expect(first.created).toBe(true);
    const rows = await t.db.emailDelivery.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ merchantId: first.merchant.id, kind: "welcome", toEmail: "ada@example.com", attempts: 0, sentAt: null });
  });

  it("waits a minute before the first send, so a payout address set at sign-in is in place", async () => {
    const now = new Date("2026-10-05T10:00:00Z");
    await resolveGoogleMerchant(t.db, { googleSub: "s1", email: "a@x.co", name: "A" }, { welcomeEmail: true, now });
    const row = await t.db.emailDelivery.findFirstOrThrow();
    expect(row.nextRetryAt!.getTime() - now.getTime()).toBe(60_000);
  });

  it("queues one email even when first sign-ins race", async () => {
    await Promise.all(
      Array.from({ length: 4 }, () => resolveGoogleMerchant(t.db, { googleSub: "racer", email: "r@x.co", name: "R" }, { welcomeEmail: true })),
    );
    expect(await t.db.merchant.count()).toBe(1);
    expect(await t.db.emailDelivery.count()).toBe(1);
  });

  it("queues nothing when email is not enabled", async () => {
    await resolveGoogleMerchant(t.db, { googleSub: "s2", email: "b@x.co", name: "B" });
    expect(await t.db.emailDelivery.count()).toBe(0);
  });

  it("is driven by the route: 201 queues one, the 200 on return queues none", async () => {
    const body = { google_sub: "did:privy:z", email: "z@x.co", name: "Z" };
    const post = () => t.app.inject({ method: "POST", url: "/internal/merchants/resolve", headers: platform, payload: body });
    expect((await post()).statusCode).toBe(201);
    expect((await post()).statusCode).toBe(200);
    expect(await t.db.emailDelivery.count()).toBe(1);
  });

  it("does not queue from the route when no key is configured", async () => {
    const bare = await setupApp();
    try {
      const res = await bare.app.inject({
        method: "POST",
        url: "/internal/merchants/resolve",
        headers: platform,
        payload: { google_sub: "did:privy:q", email: "q@x.co", name: "Q" },
      });
      expect(res.statusCode).toBe(201);
      expect(await t.db.emailDelivery.count()).toBe(0);
    } finally {
      await teardown(bare);
    }
  });
});

describe("EmailWorker", () => {
  const T0 = new Date("2026-10-05T10:01:00Z");
  type Send = NonNullable<ConstructorParameters<typeof EmailWorker>[0]["send"]>;

  const queue = async () => {
    const { merchant } = await resolveGoogleMerchant(
      t.db,
      { googleSub: "w1", email: "w@x.co", name: "W" },
      { welcomeEmail: true, now: new Date("2026-10-05T10:00:00Z") },
    );
    return merchant;
  };
  const worker = (send: Send, now: Date) => new EmailWorker({ db: t.db, logger, config: cfg, send, now: () => now });
  const ok: Send = async () => ({ ok: true });

  it("does not send before the first send time", async () => {
    await queue();
    const send = vi.fn(ok);
    expect(await worker(send, new Date("2026-10-05T10:00:30Z")).tick()).toEqual({ sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends once, marks it sent, and never sends it again", async () => {
    await queue();
    const send = vi.fn(ok);
    expect(await worker(send, T0).tick()).toEqual({ sent: 1, failed: 0 });
    await worker(send, new Date(T0.getTime() + 3_600_000)).tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe("w@x.co");
    const row = await t.db.emailDelivery.findFirstOrThrow();
    expect(row.sentAt).not.toBeNull();
    expect(row.nextRetryAt).toBeNull();
  });

  it("builds the email from the merchant as they are at send time", async () => {
    const m = await queue();
    await t.db.merchant.update({
      where: { id: m.id },
      data: { settlementAddress: "0x4CAD8fac813f7436Bac414D2C9426363567EFE7f", settlementVerified: true },
    });
    const send = vi.fn(ok);
    await worker(send, T0).tick();
    expect(send.mock.calls[0]![1].subject).toBe("You're in. Take your first payment.");
  });

  it("retries with backoff after a failure, then gives up after the last attempt", async () => {
    await queue();
    const send = vi.fn<Send>(async () => ({ ok: false, error: "resend 500: boom" }));
    let now = T0;
    for (let i = 0; i <= EMAIL_RETRY_MS.length; i++) {
      await worker(send, now).tick();
      const row = await t.db.emailDelivery.findFirstOrThrow();
      expect(row.attempts).toBe(i + 1);
      if (i < EMAIL_RETRY_MS.length) {
        expect(row.nextRetryAt!.getTime() - now.getTime()).toBe(EMAIL_RETRY_MS[i]);
        now = new Date(row.nextRetryAt!.getTime());
      } else {
        expect(row.nextRetryAt).toBeNull();
        expect(row.lastError).toBe("resend 500: boom");
      }
    }
    expect(send).toHaveBeenCalledTimes(EMAIL_RETRY_MS.length + 1);
    await worker(send, new Date(now.getTime() + 86_400_000)).tick();
    expect(send).toHaveBeenCalledTimes(EMAIL_RETRY_MS.length + 1);
  });

  it("with three workers at once, a row is sent exactly once", async () => {
    await queue();
    const send = vi.fn<Send>(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true };
    });
    await Promise.all([worker(send, T0).tick(), worker(send, T0).tick(), worker(send, T0).tick()]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a worker that died mid-send frees the row when its lease runs out", async () => {
    await queue();
    const dying = vi.fn<Send>(async () => {
      throw new Error("process killed");
    });
    await expect(worker(dying, T0).tick()).rejects.toThrow("process killed");
    const send = vi.fn(ok);
    expect(await worker(send, new Date(T0.getTime() + 30_000)).tick()).toEqual({ sent: 0, failed: 0 });
    expect(await worker(send, new Date(T0.getTime() + 121_000)).tick()).toEqual({ sent: 1, failed: 0 });
  });
});
