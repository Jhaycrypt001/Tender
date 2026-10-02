/**
 * End-to-end check of the merchant flow against a RUNNING local API + worker and
 * the REAL Aurora API. Moves no money: it mints real (empty) deposit addresses
 * and uses a throwaway wallet for the settlement address, which it discards.
 *
 *   # terminals 1 and 2, with the SAME TENDER_PLATFORM_KEY in both:
 *   TENDER_PLATFORM_KEY=tp_... npm run dev
 *   TENDER_PLATFORM_KEY=tp_... npm run dev:worker
 *   # terminal 3:
 *   TENDER_PLATFORM_KEY=tp_... npm run e2e:local
 *
 * It creates two throwaway merchants and deletes them, and their invoices, when
 * done. Needs an Aurora key with persistent deposit addresses enabled. Exits 1
 * if any check fails.
 */
import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createDb } from "../src/db/client.js";

try { process.loadEnvFile(); } catch {}
const BASE = "http://localhost:4000";
const PLATFORM = (process.env.TENDER_PLATFORM_KEY ?? (process.argv[2] ? readFileSync(process.argv[2], "utf8") : "")).trim();
if (!PLATFORM) throw new Error("set TENDER_PLATFORM_KEY to the same value the API was started with");
const stamp = Date.now();
let pass = 0, fail = 0;
const ok = (name: string, cond: unknown, detail = "") => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? "  " + detail : ""}`);
};
const call = async (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => {
  const res = await fetch(BASE + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};
const platform = { authorization: `Bearer ${PLATFORM}` };
const as = (id: string) => ({ ...platform, "x-tender-merchant": id });
const section = (s: string) => console.log(`\n--- ${s}`);

section("1. Google sign-in becomes a merchant");
const a = await call("POST", "/internal/merchants/resolve", platform, { google_sub: `e2e-a-${stamp}`, email: `e2e-a-${stamp}@example.com`, name: "E2E Merchant A" });
ok("resolve creates merchant (201)", a.status === 201, a.json?.id);
const A = a.json.id as string;
const again = await call("POST", "/internal/merchants/resolve", platform, { google_sub: `e2e-a-${stamp}`, email: `e2e-a-${stamp}@example.com` });
ok("same sign-in again is 200, same id", again.status === 200 && again.json.id === A);
const b = await call("POST", "/internal/merchants/resolve", platform, { google_sub: `e2e-b-${stamp}`, email: `e2e-b-${stamp}@example.com`, name: "E2E Merchant B" });
const B = b.json.id as string;
ok("a second Google account is a different merchant", B !== A);

section("2. Unverified merchant cannot take payments");
const early = await call("POST", "/v1/invoices", as(A), { amount_expected: "5.00", currency: "USD", reference: "early-1" });
ok("invoice refused until settlement is verified (409)", early.status === 409, early.json?.message);

section("3. Settlement proof with a throwaway wallet (EOA)");
const wallet = privateKeyToAccount(generatePrivateKey());
const patch = await call("PATCH", "/v1/merchant", as(A), { settlement_address: wallet.address });
ok("set settlement address", patch.status === 200 && patch.json.settlement_verified === false);
const ch = await call("POST", "/v1/merchant/settlement/challenge", as(A));
ok("challenge issued", ch.status === 200 && !!ch.json?.message);
const bad = await call("POST", "/v1/merchant/settlement/verify", as(A), { signature: await privateKeyToAccount(generatePrivateKey()).signMessage({ message: ch.json.message }) });
ok("signature from a different wallet is refused", bad.status >= 400, String(bad.status));
const ch2 = await call("POST", "/v1/merchant/settlement/challenge", as(A));
const sig = await wallet.signMessage({ message: ch2.json.message });
const ver = await call("POST", "/v1/merchant/settlement/verify", as(A), { signature: sig });
ok("correct signature verifies the address", ver.status === 200 && ver.json.settlement_verified === true);
const replay = await call("POST", "/v1/merchant/settlement/verify", as(A), { signature: sig });
ok("challenge is single-use (replay refused)", replay.status >= 400, String(replay.status));

section("4. Real invoice against REAL Aurora");
const t0 = Date.now();
const inv = await call("POST", "/v1/invoices", as(A), { amount_expected: "5.00", currency: "USD", reference: `order-${stamp}` });
ok("create $5 invoice (201)", inv.status === 201, `${Date.now() - t0}ms`);
const addrs: any[] = inv.json?.addresses ?? [];
ok("addresses for 17 default chains", addrs.length === 17, `got ${addrs.length}`);
const byChain = Object.fromEntries(addrs.map((x) => [x.chain, x.address]));
ok("Solana address looks real (base58, 32-44 chars)", /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(byChain.solana ?? ""), byChain.solana);
ok("Bitcoin address looks real (bc1…)", /^bc1/.test(byChain.bitcoin ?? ""), byChain.bitcoin);
ok("Tron address looks real (T…)", /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(byChain.tron ?? ""), byChain.tron);
const evm = [...new Set(["ethereum", "base", "arbitrum", "monad", "optimism", "polygon", "bnb", "avalanche", "gnosis", "scroll", "berachain", "plasma", "xlayer", "adi"].map((c) => byChain[c]))];
ok("all 14 EVM chains share ONE address", evm.length === 1 && /^0x[0-9a-fA-F]{40}$/.test(evm[0] ?? ""), evm[0]);
ok("status PENDING, token chk_", inv.json?.status === "PENDING" && /^chk_/.test(inv.json?.token ?? ""));
const retry = await call("POST", "/v1/invoices", as(A), { amount_expected: "5.00", currency: "USD", reference: `order-${stamp}` });
ok("same reference + same body returns the same invoice (200)", retry.status === 200 && retry.json.id === inv.json.id);
const conflict = await call("POST", "/v1/invoices", as(A), { amount_expected: "9.00", currency: "USD", reference: `order-${stamp}` });
ok("same reference + different amount is refused (409)", conflict.status === 409);

section("5. Opt-in chains: XRP, TON, NEAR, Cardano, Polygon");
const opt = await call("POST", "/v1/invoices", as(A), { amount_expected: "5.00", currency: "USD", reference: `opt-${stamp}`, chains: ["xrp", "ton", "near", "cardano", "polygon"] });
ok("create with opt-in chains (201)", opt.status === 201, `${opt.json?.addresses?.length} addresses`);
const oa = Object.fromEntries((opt.json?.addresses ?? []).map((x: any) => [x.chain, x]));
ok("XRP r-address, no memo", /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(oa.xrp?.address ?? "") && !("memo" in (oa.xrp ?? {})), oa.xrp?.address);
ok("TON address", /^(UQ|EQ)/.test(oa.ton?.address ?? ""), oa.ton?.address);
ok("Cardano addr1…", /^addr1/.test(oa.cardano?.address ?? ""), oa.cardano?.address?.slice(0, 20));
const stellar = await call("POST", "/v1/invoices", as(A), { amount_expected: "5.00", currency: "USD", reference: `st-${stamp}`, chains: ["stellar"] });
ok("Stellar is refused (400)", stellar.status === 400);

section("6. The buyer's checkout (no auth)");
const pub = await call("GET", `/public/invoices/${inv.json.token}`);
ok("public invoice readable", pub.status === 200 && pub.json.status === "PENDING", `${pub.status} ${pub.text.slice(0, 90)} | token=${inv.json.token}`);
ok("leaks no settlement address, email, merchant id or reference", !new RegExp(`${wallet.address}|example\\.com|${A}|order-${stamp}`, "i").test(pub.text));
const sse = await fetch(`${BASE}/public/invoices/${inv.json.token}/events`);
const reader = sse.body!.getReader();
const first = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
const firstText = first ? new TextDecoder().decode((first as any).value) : "";
ok("SSE opens and sends the current status at once", sse.status === 200 && sse.headers.get("content-type")!.includes("text/event-stream") && /PENDING/.test(firstText), firstText.trim().slice(0, 70));
ok("SSE sets x-accel-buffering: no", sse.headers.get("x-accel-buffering") === "no");
await reader.cancel();
const chains = await call("GET", "/public/chains");
ok("/public/chains answers (503 until minimums are measured is expected)", [200, 503].includes(chains.status), `${chains.status} ${chains.status === 200 ? chains.json.chains?.length + " chains" : chains.json?.error}`);

section("7. Isolation between merchants");
const peek = await call("GET", `/v1/invoices/${inv.json.id}`, as(B));
ok("merchant B cannot read merchant A's invoice (404)", peek.status === 404);
const noHeader = await call("GET", "/v1/merchant", platform);
ok("platform key without merchant header (401)", noHeader.status === 401);

section("8. Payment links");
const link = await call("POST", "/v1/links", as(A), { label: "T-shirt", amount: "9.00", currency: "USD" });
ok("create link", link.status === 201, link.json?.token);
const prev = await call("GET", `/public/links/${link.json.token}`);
ok("preview shows merchant name, label, amount", prev.json?.merchant_name === "E2E Merchant A" && prev.json?.amount === "9.00", JSON.stringify(prev.json));
const afterPrev = (await call("GET", "/v1/links", as(A))).json.data[0].uses;
ok("preview did not count as a use", afterPrev === 0);
const opened = await call("POST", `/public/links/${link.json.token}`, {}, {});
ok("opening the link creates a real invoice", opened.status === 201 && /^chk_/.test(opened.json?.token ?? ""), opened.json?.token);
const linkInv = await call("GET", `/public/invoices/${opened.json.token}`);
ok("…for $9.00 with addresses", linkInv.json?.amount_expected === "9.00" && linkInv.json?.addresses?.length === 17);

section("9. API keys and webhook secret");
const k = await call("POST", "/v1/merchant/api-keys", as(A));
ok("issue key (shown once)", k.status === 201 && /^tk_live_/.test(k.json?.key ?? ""), k.json?.prefix);
const viaKey = await call("GET", "/v1/merchant", { authorization: `Bearer ${k.json.key}` });
ok("new key works on its own", viaKey.status === 200 && viaKey.json.id === A);
const list = await call("GET", "/v1/merchant/api-keys", as(A));
ok("list shows prefix, never the key", list.status === 200 && !list.text.includes(k.json.key) && list.json.data.length === 1);
const del = await call("DELETE", `/v1/merchant/api-keys/${k.json.id}`, as(A));
ok("revoke (204)", del.status === 204);
const dead = await call("GET", "/v1/merchant", { authorization: `Bearer ${k.json.key}` });
ok("revoked key stops at once (401)", dead.status === 401);
const sec = await call("POST", "/v1/merchant/webhook/secret", as(A));
ok("rotate webhook secret", sec.status === 201 && /^whsec_/.test(sec.json?.webhook_secret ?? ""));
const dl = await call("GET", "/v1/merchant/webhook/deliveries", as(A));
ok("webhook deliveries list answers", dl.status === 200 && Array.isArray(dl.json?.data), `${dl.json?.data?.length} deliveries`);

section("10. Dashboard reads");
for (const [path, label] of [["/v1/merchant/balance", "balance"], ["/v1/invoices", "invoices"], ["/v1/payments", "payments"], ["/v1/links", "links"]] as const) {
  const r = await call("GET", path, as(A));
  ok(`GET ${path} (${label})`, r.status === 200);
}
const cancel = await call("POST", `/v1/invoices/${opt.json.id}/cancel`, as(A));
ok("cancel an unpaid invoice", cancel.status === 200 && cancel.json.status === "CANCELLED", cancel.json?.status);

section("11. The worker is polling the real addresses");
await new Promise((r) => setTimeout(r, 12_000));
const db = createDb(process.env.DATABASE_URL ?? "postgresql://tender:tender@localhost:5434/tender");
const rows = await db.invoiceAddress.findMany({ where: { invoiceId: inv.json.id }, select: { nextPollAt: true, pollFailures: true } });
const recent = rows.filter((r) => r.nextPollAt.getTime() > Date.now() - 60_000);
ok("every address of the invoice was polled and rescheduled", rows.length === 4 && rows.every((r) => r.pollFailures === 0) && recent.length === 4, `${rows.length} addresses (one per family), failures=${rows.map((r) => r.pollFailures).join(",")}`);
const w = await fetch("http://localhost:9464/metrics");
const wm = await w.text();
ok("worker /metrics exposes the alert gauges", /tender_poll_lag_seconds/.test(wm) && /tender_webhook_dead_letters/.test(wm) && /tender_chain_minimums_age_seconds/.test(wm));
const lag = /tender_poll_lag_seconds ([0-9.]+)/.exec(wm)?.[1];
ok("poll lag is small", Number(lag) < 30, `${lag}s`);

// Clean up the throwaway merchants. The schema has no cascade from Merchant, so go child to parent.
const mids = (await db.merchant.findMany({ where: { googleSub: { in: [`e2e-a-${stamp}`, `e2e-b-${stamp}`] } }, select: { id: true } })).map((m) => m.id);
const invs = (await db.invoice.findMany({ where: { merchantId: { in: mids } }, select: { id: true } })).map((i) => i.id);
const pays = (await db.payment.findMany({ where: { invoiceId: { in: invs } }, select: { id: true } })).map((p) => p.id);
await db.recoveryTask.deleteMany({ where: { paymentId: { in: pays } } });
await db.payment.deleteMany({ where: { invoiceId: { in: invs } } });
await db.invoiceEvent.deleteMany({ where: { invoiceId: { in: invs } } });
await db.invoiceAddress.deleteMany({ where: { invoiceId: { in: invs } } });
await db.webhookDelivery.deleteMany({ where: { merchantId: { in: mids } } });
await db.invoice.deleteMany({ where: { id: { in: invs } } });
await db.paymentLink.deleteMany({ where: { merchantId: { in: mids } } });
await db.merchant.deleteMany({ where: { id: { in: mids } } });
await db.$disconnect();

console.log(`\nsettlement wallet used: ${wallet.address}  (throwaway; no funds, key discarded)`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
