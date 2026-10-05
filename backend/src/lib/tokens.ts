/**
 * The tokens a merchant can send out of their wallet through Tender, and what
 * their wallet must sign for each.
 *
 * ⚠️ Every value here was read from Monad itself, not from documentation:
 * the contract address, the decimals, and the EIP-712 domain (name and
 * version), which was recomputed and matched against each token's own
 * `DOMAIN_SEPARATOR()`. A wrong domain makes every signature invalid, so do
 * not edit these without repeating that check.
 *
 * Only these two, because they are the tokens that implement EIP-3009
 * (`transferWithAuthorization`), which is what lets a signature move money with
 * no gas from the signer. MON is the chain's own coin and has no such
 * mechanism, so a merchant who settles in MON sends it from their own wallet.
 */

export const MONAD_CHAIN_ID = 143;

export type TokenInfo = {
  symbol: "USDC" | "USDT0";
  address: `0x${string}`;
  decimals: number;
  /** The EIP-712 domain the token verifies signatures against. */
  domain: { name: string; version: string };
};

export const TOKENS: Record<string, TokenInfo> = {
  USDC: {
    symbol: "USDC",
    address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    decimals: 6,
    domain: { name: "USDC", version: "2" },
  },
  USDT0: {
    symbol: "USDT0",
    address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
    decimals: 6,
    // USDT0 has no `version()` getter; "1" is the version whose domain hash matches DOMAIN_SEPARATOR().
    domain: { name: "USDT0", version: "1" },
  },
};

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/** The EIP-3009 typed-data shape, shared by every token above. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function tokenFor(asset: string | null | undefined): TokenInfo | null {
  return asset && Object.hasOwn(TOKENS, asset) ? TOKENS[asset]! : null;
}
