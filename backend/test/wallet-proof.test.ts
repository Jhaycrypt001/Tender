import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client.js";
import type { Merchant } from "../src/generated/prisma/client.js";
import { issueChallenge, verifyChallenge, type ChainReader } from "../src/services/settlement-proof.service.js";

/** In-memory stand-ins: this file tests the signature logic, not storage. */
function fakes(address: string) {
  const store = new Map<string, string>();
  const redis = {
    set: vi.fn(async (k: string, v: string) => (store.set(k, v), "OK")),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  };
  const merchant = { id: "m_1", settlementAddress: address, settlementVerified: false } as Merchant;
  const db = { merchant: { update: vi.fn(async () => ({ ...merchant, settlementVerified: true })) } } as unknown as Db;
  return { redis, db, merchant };
}

describe("settlement proof: wallet types", () => {
  it("verifies an ordinary wallet locally, without touching the chain", async () => {
    const wallet = privateKeyToAccount(generatePrivateKey());
    const { redis, db, merchant } = fakes(wallet.address);
    const chain = { getCode: vi.fn(), verifyMessage: vi.fn() };

    const { message } = await issueChallenge(redis as never, merchant);
    const signature = await wallet.signMessage({ message });
    const result = await verifyChallenge({ db, redis: redis as never, chain: chain as unknown as ChainReader }, merchant, signature);

    expect(result.settlementVerified).toBe(true);
    expect(chain.getCode).not.toHaveBeenCalled();
  });

  it("verifies a smart-contract wallet by asking the contract (ERC-1271)", async () => {
    const safe = "0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe";
    const { redis, db, merchant } = fakes(safe);
    const chain = {
      getCode: vi.fn(async () => "0x6080604052" as const),
      verifyMessage: vi.fn(async () => true),
    };

    await issueChallenge(redis as never, merchant);
    const result = await verifyChallenge({ db, redis: redis as never, chain: chain as unknown as ChainReader }, merchant, "0x1234");

    expect(result.settlementVerified).toBe(true);
    expect(chain.verifyMessage).toHaveBeenCalledWith(expect.objectContaining({ address: safe }));
  });

  it("rejects when the address has no code and the signature is not the owner's", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const { redis, db, merchant } = fakes(owner.address);
    const chain = { getCode: vi.fn(async () => undefined), verifyMessage: vi.fn(async () => true) };

    await issueChallenge(redis as never, merchant);
    const attacker = privateKeyToAccount(generatePrivateKey());
    const signature = await attacker.signMessage({ message: "anything" });

    await expect(
      verifyChallenge({ db, redis: redis as never, chain: chain as unknown as ChainReader }, merchant, signature),
    ).rejects.toMatchObject({ code: "invalid_signature" });
    // No code on-chain, so the contract path is never trusted.
    expect(chain.verifyMessage).not.toHaveBeenCalled();
  });

  it("treats an RPC outage as a failed proof, never as a pass", async () => {
    const { redis, db, merchant } = fakes("0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe");
    const chain = { getCode: vi.fn(async () => { throw new Error("rpc down"); }), verifyMessage: vi.fn(async () => true) };

    await issueChallenge(redis as never, merchant);
    await expect(
      verifyChallenge({ db, redis: redis as never, chain: chain as unknown as ChainReader }, merchant, "0x1234"),
    ).rejects.toMatchObject({ code: "invalid_signature" });
  });
});
