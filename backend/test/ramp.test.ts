import { beforeEach, describe, expect, it, vi } from "vitest";
import { RampService } from "../src/services/ramp.service.js";

const logger = { warn: vi.fn(), error: vi.fn() };

const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

/** Just enough of ioredis for the service: values with an expiry in ms. */
function fakeRedis(clock: { now: Date }) {
  const store = new Map<string, { value: string; expires: number }>();
  return {
    get: vi.fn(async (key: string) => {
      const hit = store.get(key);
      return hit && hit.expires > clock.now.getTime() ? hit.value : null;
    }),
    set: vi.fn(async (key: string, value: string, _mode: string, ms: number) => {
      store.set(key, { value, expires: clock.now.getTime() + ms });
      return "OK";
    }),
  };
}

const assets = (monad: object[]) => ({ currencyCode: "USD", minPurchaseAmount: 7.5, maxPurchaseAmount: 17000, assets: [{ symbol: "ETH", chain: "ETH", address: null, enabled: true }, ...monad] });
const monadUsdc = (over: object = {}) => ({ symbol: "USDC", chain: "MONAD", address: USDC, decimals: 6, enabled: true, ...over });
const unsupported = (currency: string) => ({ currency, code: "SERVICES.HOST_API.FIAT_CURRENCY_NOT_SUPPORTED", statusCode: 400 });

/** Answers per currency, read from the `currencyCode` in the URL. */
function ramp(answers: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (url: string | URL | Request) => {
    const currency = new URL(String(url)).searchParams.get("currencyCode")!;
    return answers[currency]!();
  });
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

let clock: { now: Date };
function service(fetchMock: ReturnType<typeof ramp>) {
  return new RampService(fakeRedis(clock) as unknown as ConstructorParameters<typeof RampService>[0], logger, fetchMock as unknown as typeof fetch, () => clock.now);
}

beforeEach(() => {
  clock = { now: new Date("2026-10-28T10:00:00Z") };
  logger.warn.mockClear();
});

const byCurrency = (list: { currency: string; status: string }[]) => Object.fromEntries(list.map((c) => [c.currency, c.status]));

describe("RampService corridors", () => {
  it("marks a currency LIVE only when Ramp enables Monad USDC, and lists Nigeria as NOT_OPEN", async () => {
    const svc = service(
      ramp({
        USD: json(assets([monadUsdc()])),
        EUR: json(assets([monadUsdc()])),
        GBP: json(assets([monadUsdc()])),
        NGN: json(unsupported("NGN"), 400),
      }),
    );
    const list = await svc.corridors("USDC");
    expect(byCurrency(list)).toEqual({ USD: "LIVE", EUR: "LIVE", GBP: "LIVE", NGN: "NOT_OPEN" });
    expect(list.find((c) => c.currency === "NGN")).toEqual({ country: "Nigeria", currency: "NGN", status: "NOT_OPEN" });
  });

  it("never sets a cap: Ramp's maximum is per sale, not per day", async () => {
    const list = await service(ramp({ USD: json(assets([monadUsdc()])), EUR: json(assets([monadUsdc()])), GBP: json(assets([monadUsdc()])), NGN: json(unsupported("NGN"), 400) })).corridors("USDC");
    for (const c of list) expect(c).not.toHaveProperty("daily_cap");
  });

  it.each([
    ["Monad USDC is disabled", assets([monadUsdc({ enabled: false })])],
    ["Monad has no USDC at all", assets([{ symbol: "USDT0", chain: "MONAD", address: "0xe7cd86e13ac4309349f30b3435a9d337750fc82d", enabled: true }])],
    ["there is no Monad", assets([])],
    ["the USDC is a different contract", assets([monadUsdc({ address: "0x0000000000000000000000000000000000000001" })])],
    ["enabled is not literally true", assets([monadUsdc({ enabled: "yes" })])],
  ])("is NOT_OPEN when %s", async (_why, body) => {
    const svc = service(ramp({ USD: json(body), EUR: json(body), GBP: json(body), NGN: json(body) }));
    expect(Object.values(byCurrency(await svc.corridors("USDC")))).toEqual(["NOT_OPEN", "NOT_OPEN", "NOT_OPEN", "NOT_OPEN"]);
  });

  it("answers for the merchant's own settlement token: USDT0 merchants need USDT0 enabled, not USDC", async () => {
    const usdt0 = { symbol: "USDT0", chain: "MONAD", address: "0xe7cd86e13ac4309349f30b3435a9d337750fc82d", decimals: 6, enabled: true };
    const onlyUsdc = json(assets([monadUsdc()]));
    const onlyUsdt0 = json(assets([usdt0]));
    const svc = service(ramp({ USD: onlyUsdc, EUR: onlyUsdt0, GBP: json(assets([monadUsdc(), usdt0])), NGN: json(unsupported("NGN"), 400) }));

    expect(byCurrency(await svc.corridors("USDC"))).toEqual({ USD: "LIVE", EUR: "NOT_OPEN", GBP: "LIVE", NGN: "NOT_OPEN" });
    expect(byCurrency(await svc.corridors("USDT0"))).toEqual({ USD: "NOT_OPEN", EUR: "LIVE", GBP: "LIVE", NGN: "NOT_OPEN" });
  });

  it("treats a merchant with no settlement asset as USDC, and one it cannot match to a Monad token as NOT_OPEN", async () => {
    const good = json(assets([monadUsdc()]));
    const fetchMock = ramp({ USD: good, EUR: good, GBP: good, NGN: json(unsupported("NGN"), 400) });
    const svc = service(fetchMock);
    expect(byCurrency(await svc.corridors(null)).USD).toBe("LIVE");
    expect(Object.values(byCurrency(await svc.corridors("MON")))).toEqual(["NOT_OPEN", "NOT_OPEN", "NOT_OPEN", "NOT_OPEN"]);
    expect(Object.values(byCurrency(await svc.corridors("nep141:something.omft.near")))).toEqual(["NOT_OPEN", "NOT_OPEN", "NOT_OPEN", "NOT_OPEN"]);
    // One cached answer per currency serves every merchant: three questions, still one call each.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("re-fetches rather than trusts a malformed cache entry", async () => {
    const redis = fakeRedis(clock);
    await redis.set("tender:ramp:offramp:v2:USD", JSON.stringify({ sellable: "USDC", fetchedAt: "x" }), "PX", 60_000);
    const good = json(assets([monadUsdc()]));
    const fetchMock = ramp({ USD: good, EUR: good, GBP: good, NGN: json(unsupported("NGN"), 400) });
    const svc = new RampService(redis as unknown as ConstructorParameters<typeof RampService>[0], logger, fetchMock as unknown as typeof fetch, () => clock.now);
    expect(byCurrency(await svc.corridors("USDC")).USD).toBe("LIVE");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("matches Ramp's address regardless of letter case", async () => {
    const lower = assets([monadUsdc({ address: USDC.toLowerCase() })]);
    const svc = service(ramp({ USD: json(lower), EUR: json(lower), GBP: json(lower), NGN: json(unsupported("NGN"), 400) }));
    expect(byCurrency(await svc.corridors("USDC")).USD).toBe("LIVE");
  });

  it("is NOT_OPEN, and says so in the log, on every kind of failure", async () => {
    const svc = service(
      ramp({
        USD: json({}, 500),
        EUR: json("not an object"),
        GBP: () => {
          throw new Error("network down");
        },
        NGN: json({ code: "SOMETHING_ELSE" }, 400),
      }),
    );
    expect(Object.values(byCurrency(await svc.corridors("USDC")))).toEqual(["NOT_OPEN", "NOT_OPEN", "NOT_OPEN", "NOT_OPEN"]);
    expect(logger.warn).toHaveBeenCalledTimes(4);
  });

  it("asks Ramp once an hour per currency, not on every page load", async () => {
    const good = json(assets([monadUsdc()]));
    const fetchMock = ramp({ USD: good, EUR: good, GBP: good, NGN: json(unsupported("NGN"), 400) });
    const svc = service(fetchMock);

    await svc.corridors("USDC");
    clock.now = new Date("2026-10-28T10:30:00Z");
    await svc.corridors("USDC");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    clock.now = new Date("2026-10-28T11:05:00Z");
    await svc.corridors("USDC");
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("retries a failed lookup after a minute and does not keep a stale LIVE once Ramp stops saying it", async () => {
    let up = true;
    const answer = () => (up ? new Response(JSON.stringify(assets([monadUsdc()])), { status: 200 }) : new Response("{}", { status: 503 }));
    const fetchMock = ramp({ USD: answer, EUR: answer, GBP: answer, NGN: answer });
    const svc = service(fetchMock);

    expect(byCurrency(await svc.corridors("USDC")).USD).toBe("LIVE");

    // Ramp goes down. The hour-old LIVE answer is gone, and the failure is what is remembered.
    up = false;
    clock.now = new Date("2026-10-28T11:05:00Z");
    expect(byCurrency(await svc.corridors("USDC")).USD).toBe("NOT_OPEN");
    const calls = fetchMock.mock.calls.length;

    // Within the minute, no new call.
    clock.now = new Date("2026-10-28T11:05:30Z");
    await svc.corridors("USDC");
    expect(fetchMock).toHaveBeenCalledTimes(calls);

    // After it, and Ramp is back, the corridor recovers.
    up = true;
    clock.now = new Date("2026-10-28T11:07:00Z");
    expect(byCurrency(await svc.corridors("USDC")).USD).toBe("LIVE");
  });

  it("still answers when Redis is down", async () => {
    const broken = { get: vi.fn().mockRejectedValue(new Error("redis down")), set: vi.fn().mockRejectedValue(new Error("redis down")) };
    const good = json(assets([monadUsdc()]));
    const svc = new RampService(broken, logger, ramp({ USD: good, EUR: good, GBP: good, NGN: json(unsupported("NGN"), 400) }) as unknown as typeof fetch);
    expect(byCurrency(await svc.corridors("USDC"))).toEqual({ USD: "LIVE", EUR: "LIVE", GBP: "LIVE", NGN: "NOT_OPEN" });
  });
});
