import { generateKeyPairSync, sign } from "node:crypto";
import stringify from "fast-json-stable-stringify";
import { describe, expect, it } from "vitest";
import { rampPublicKey, verifyRampSignature } from "../src/lib/ramp-signature.js";

const pair = () => generateKeyPairSync("ec", { namedCurve: "secp256k1" });
/** Signs the way Ramp documents: SHA-256 ECDSA (DER) over the stable-stringified body, base64. */
const signBody = (body: object, key: ReturnType<typeof pair>["privateKey"]) => sign("sha256", Buffer.from(stringify(body)), key).toString("base64");

const BODY = { id: "evt_1", type: "RELEASED", mode: "OFFRAMP", payload: { id: "sale_1", fiat: { amount: "3.71", currencySymbol: "GBP" } } };

describe("verifyRampSignature", () => {
  const { publicKey, privateKey } = pair();

  it("accepts a signature Ramp's key made over this exact body", () => {
    expect(verifyRampSignature(BODY, signBody(BODY, privateKey), publicKey)).toBe(true);
  });

  it("does not care what order the keys arrived in: the signature is over the sorted body", () => {
    const reordered = { payload: { fiat: { currencySymbol: "GBP", amount: "3.71" }, id: "sale_1" }, mode: "OFFRAMP", type: "RELEASED", id: "evt_1" };
    expect(verifyRampSignature(reordered, signBody(BODY, privateKey), publicKey)).toBe(true);
  });

  it("rejects a body changed after signing, even by one character", () => {
    const sig = signBody(BODY, privateKey);
    expect(verifyRampSignature({ ...BODY, payload: { ...BODY.payload, fiat: { amount: "3.72", currencySymbol: "GBP" } } }, sig, publicKey)).toBe(false);
    expect(verifyRampSignature({ ...BODY, type: "EXPIRED" }, sig, publicKey)).toBe(false);
  });

  it("rejects a signature from any other key", () => {
    const other = pair();
    expect(verifyRampSignature(BODY, signBody(BODY, other.privateKey), publicKey)).toBe(false);
  });

  it("rejects, rather than throws on, anything malformed", () => {
    expect(verifyRampSignature(BODY, undefined, publicKey)).toBe(false);
    expect(verifyRampSignature(BODY, "", publicKey)).toBe(false);
    expect(verifyRampSignature(BODY, "not base64 at all !!!", publicKey)).toBe(false);
    expect(verifyRampSignature(BODY, Buffer.from("garbage").toString("base64"), publicKey)).toBe(false);
    expect(verifyRampSignature(null, signBody(BODY, privateKey), publicKey)).toBe(false);
    expect(verifyRampSignature("a string", signBody(BODY, privateKey), publicKey)).toBe(false);
    expect(verifyRampSignature(undefined, signBody(BODY, privateKey), publicKey)).toBe(false);
  });
});

describe("Ramp's published keys", () => {
  it("both load as secp256k1 public keys, and they are different keys", () => {
    for (const env of ["production", "testing"] as const) {
      const key = rampPublicKey(env);
      expect(key.asymmetricKeyType).toBe("ec");
      expect(key.asymmetricKeyDetails?.namedCurve).toBe("secp256k1");
    }
    expect(rampPublicKey("production").export({ type: "spki", format: "der" }).equals(rampPublicKey("testing").export({ type: "spki", format: "der" }))).toBe(false);
  });

  it("do not accept a signature made by some other key", () => {
    const attacker = pair();
    expect(verifyRampSignature(BODY, signBody(BODY, attacker.privateKey), rampPublicKey("production"))).toBe(false);
    expect(verifyRampSignature(BODY, signBody(BODY, attacker.privateKey), rampPublicKey("testing"))).toBe(false);
  });
});
