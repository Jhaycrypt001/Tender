import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Agent } from "undici";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyWebhook } from "../src/lib/crypto.js";
import { createLogger } from "../src/lib/logger.js";
import { assertSafeWebhookUrl, isPublicAddress } from "../src/lib/safe-http.js";
import { sendWebhook } from "../src/services/webhook.service.js";
import { RETRY_SCHEDULE_MS, WebhookWorker } from "../src/workers/webhook.worker.js";
import { merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

/* -------------------------------------------------------------------------- */
/* A local receiver standing in for a merchant's server                        */
/* -------------------------------------------------------------------------- */

type Received = { headers: IncomingMessage["headers"]; body: string };
let receiver: Server;
let receiverUrl: string;
let received: Received[] = [];
let respondWith = 200;

/** Tests may reach the loopback receiver; production never can. */
const loopback = new Agent();

beforeAll(async () => {
  receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.statusCode = respondWith;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks`;
});
afterAll(async () => {
  await new Promise((r) => receiver.close(r));
  await loopback.close();
});
beforeEach(() => {
  received = [];
  respondWith = 200;
});

describe("SSRF guard", () => {
  it("classifies addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
      "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::a00:1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("refuses to send to loopback, by literal and by hostname", async () => {
    for (const url of [receiverUrl, receiverUrl.replace("127.0.0.1", "localhost"), "https://169.254.169.254/latest/meta-data"]) {
      const res = await sendWebhook(url, "whsec_x", { id: "evt_1" });
      expect(res.ok, url).toBe(false);
    }
    expect(received).toHaveLength(0);
  });

  it("validates webhook URLs when they are saved", async () => {
    await expect(assertSafeWebhookUrl("http://example.com/hooks")).rejects.toThrow(/https/);
    await expect(assertSafeWebhookUrl("https://user:pw@example.com/")).rejects.toThrow(/credentials/);
    await expect(assertSafeWebhookUrl("https://127.0.0.1/")).rejects.toThrow(/non-public/);
    await expect(assertSafeWebhookUrl("https://localhost/")).rejects.toThrow(/non-public/);
    await expect(assertSafeWebhookUrl("not a url")).rejects.toThrow(/valid URL/);
  });
});

describe("sendWebhook", () => {
  it("signs the raw body so the published /docs snippet verifies it", async () => {
    const payload = { id: "evt_abc", event: "invoice.settled", data: { status: "SETTLED" } };
    const res = await sendWebhook(receiverUrl, "whsec_secret", payload, { dispatcher: loopback });
    expect(res).toEqual({ ok: true, status: 200 });

    const [hit] = received;
    expect(hit!.headers["x-tender-event-id"]).toBe("evt_abc");
    expect(Number(hit!.headers["x-tender-timestamp"])).toBeGreaterThan(1_700_000_000);
    expect(verifyWebhook(hit!.body, hit!.headers["x-tender-signature"] as string, "whsec_secret")).toBe(true);
  });

  it("treats a non-2xx, including a redirect, as a failure", async () => {
    for (const code of [500, 404, 302]) {
      respondWith = code;
      const res = await sendWebhook(receiverUrl, "s", { id: "evt_1" }, { dispatcher: loopback });
      expect(res).toMatchObject({ ok: false, status: code });
    }
  });
});

describe("WebhookWorker", () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await setupApp();
  });
  afterAll(() => teardown(t));
  beforeEach(() => resetDb(t.db));

  async function queued() {
    const m = await merchant(t.db);
    await t.db.merchant.update({ where: { id: m.merchant.id }, data: { webhookUrl: receiverUrl } });
    const row = await t.db.webhookDelivery.create({
      data: {
        merchantId: m.merchant.id,
        invoiceId: "inv_test",
        event: "invoice.settled",
        payload: { id: "evt_q1", event: "invoice.settled", data: {} },
        nextRetryAt: new Date(),
      },
    });
    return row.id;
  }

  const worker = (clock: { now: Date }) =>
    new WebhookWorker({ db: t.db, logger: createLogger("fatal", false), dispatcher: loopback, now: () => clock.now });

  it("delivers once and marks it delivered", async () => {
    const id = await queued();
    const clock = { now: new Date() };
    expect(await worker(clock).tick()).toEqual({ delivered: 1, failed: 0 });
    expect(await worker(clock).tick()).toEqual({ delivered: 0, failed: 0 });
    expect(received).toHaveLength(1);
    expect((await t.db.webhookDelivery.findUniqueOrThrow({ where: { id } })).deliveredAt).not.toBeNull();
  });

  it("retries on the schedule, then gives up", async () => {
    const id = await queued();
    respondWith = 503;
    const clock = { now: new Date() };
    for (let attempt = 1; attempt <= RETRY_SCHEDULE_MS.length + 1; attempt++) {
      await worker(clock).tick();
      const row = await t.db.webhookDelivery.findUniqueOrThrow({ where: { id } });
      expect(row.attempts).toBe(attempt);
      if (attempt <= RETRY_SCHEDULE_MS.length) {
        expect(row.nextRetryAt!.getTime() - clock.now.getTime()).toBe(RETRY_SCHEDULE_MS[attempt - 1]);
        clock.now = row.nextRetryAt!;
      } else {
        expect(row.nextRetryAt).toBeNull(); // gave up
        expect(row.lastError).toContain("503");
      }
    }
  });

  it("never sends the same row twice when two workers run at once", async () => {
    await queued();
    const clock = { now: new Date() };
    await Promise.all([worker(clock).tick(), worker(clock).tick(), worker(clock).tick()]);
    expect(received).toHaveLength(1);
  });
});
