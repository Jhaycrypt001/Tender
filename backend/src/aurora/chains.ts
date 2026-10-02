/**
 * Tender's chain names (what the wire contract uses: "bitcoin", "solana", …)
 * mapped to Aurora's short codes ("btc", "sol", …) and deposit families.
 *
 * A family is the unit Aurora mints one address for. All EVM chains share a
 * single address (verified live 2026-09-26), so they are one family, "evm".
 * Every other chain is its own family.
 *
 * The 30 chains are exactly what Aurora's persistent-address `depositChain`
 * enum accepts (docs/INTEGRATION.md §8), minus Stellar: its deposits need a
 * memo, and the published InvoiceAddress shape has nowhere to carry one. See
 * BACKEND.md constraint #2a. Every `asset` below was read from Aurora's live
 * token list (`npm run aurora:tokens`): `measureCatalogue` silently drops a chain
 * whose `blockchain` code + `asset` symbol is not listed there.
 */
export type ChainInfo = {
  /** Tender's wire name. */
  id: string;
  name: string;
  /** Aurora's chain code. */
  aurora: string;
  /** Mint unit: "evm" for every EVM chain, otherwise the Aurora code. */
  family: string;
  /** The asset a buyer typically sends here, for display. */
  asset: string;
};

export const CHAINS: readonly ChainInfo[] = [
  { id: "bitcoin", name: "Bitcoin", aurora: "btc", family: "btc", asset: "BTC" },
  { id: "solana", name: "Solana", aurora: "sol", family: "sol", asset: "SOL" },
  { id: "tron", name: "Tron", aurora: "tron", family: "tron", asset: "USDT" },
  { id: "ethereum", name: "Ethereum", aurora: "eth", family: "evm", asset: "ETH" },
  { id: "base", name: "Base", aurora: "base", family: "evm", asset: "USDC" },
  { id: "arbitrum", name: "Arbitrum", aurora: "arb", family: "evm", asset: "USDC" },
  { id: "monad", name: "Monad", aurora: "monad", family: "evm", asset: "MON" },
  { id: "optimism", name: "Optimism", aurora: "op", family: "evm", asset: "USDC" },
  { id: "polygon", name: "Polygon", aurora: "pol", family: "evm", asset: "USDC" },
  { id: "bnb", name: "BNB Chain", aurora: "bsc", family: "evm", asset: "USDC" },
  { id: "avalanche", name: "Avalanche", aurora: "avax", family: "evm", asset: "USDC" },
  { id: "gnosis", name: "Gnosis", aurora: "gnosis", family: "evm", asset: "USDC" },
  // Scroll lists no USDC: ETH and USDT only.
  { id: "scroll", name: "Scroll", aurora: "scroll", family: "evm", asset: "ETH" },
  { id: "berachain", name: "Berachain", aurora: "bera", family: "evm", asset: "BERA" },
  // Plasma also lists "USDT0(DEPRECATED)" and "XPL_(DEPRECATED)": never use those.
  { id: "plasma", name: "Plasma", aurora: "plasma", family: "evm", asset: "USDT0" },
  { id: "xlayer", name: "X Layer", aurora: "xlayer", family: "evm", asset: "USDC" },
  { id: "adi", name: "ADI", aurora: "adi", family: "evm", asset: "ADI" },
  { id: "near", name: "NEAR", aurora: "near", family: "near", asset: "USDC" },
  { id: "sui", name: "Sui", aurora: "sui", family: "sui", asset: "USDC" },
  { id: "aptos", name: "Aptos", aurora: "aptos", family: "aptos", asset: "USDC" },
  { id: "ton", name: "TON", aurora: "ton", family: "ton", asset: "USDT" },
  { id: "xrp", name: "XRP", aurora: "xrp", family: "xrp", asset: "XRP" },
  { id: "cardano", name: "Cardano", aurora: "cardano", family: "cardano", asset: "ADA" },
  { id: "dogecoin", name: "Dogecoin", aurora: "doge", family: "doge", asset: "DOGE" },
  { id: "litecoin", name: "Litecoin", aurora: "ltc", family: "ltc", asset: "LTC" },
  { id: "bitcoincash", name: "Bitcoin Cash", aurora: "bch", family: "bch", asset: "BCH" },
  { id: "zcash", name: "Zcash", aurora: "zec", family: "zec", asset: "ZEC" },
  { id: "starknet", name: "Starknet", aurora: "starknet", family: "starknet", asset: "STRK" },
  { id: "aleo", name: "Aleo", aurora: "aleo", family: "aleo", asset: "ALEO" },
  { id: "dash", name: "Dash", aurora: "dash", family: "dash", asset: "DASH" },
];

const byId = new Map(CHAINS.map((c) => [c.id, c]));
const byAurora = new Map(CHAINS.map((c) => [c.aurora, c]));

export function chainById(id: string): ChainInfo | undefined {
  return byId.get(id);
}

/** Aurora code → Tender name. Unknown codes pass through unchanged. */
export function tenderChainName(auroraCode: string | null | undefined): string {
  if (!auroraCode) return "unknown";
  return byAurora.get(auroraCode)?.id ?? auroraCode;
}

/** The distinct families needed to cover a set of Tender chain ids. */
export function familiesFor(chainIds: readonly string[]): string[] {
  const families = chainIds.map((id) => byId.get(id)?.family).filter((f): f is string => !!f);
  return [...new Set(families)];
}

/** Every Tender chain id served by one family's address. */
export function chainsInFamily(family: string, accepted: readonly string[]): string[] {
  return accepted.filter((id) => byId.get(id)?.family === family);
}

/**
 * What an invoice accepts when the merchant does not choose: the original 7
 * plus every EVM chain. EVM chains all share ONE deposit address, so they cost
 * no extra Aurora call. A non-EVM chain is its own family and costs one mint
 * call per invoice, in parallel, and one failure fails the whole invoice (502):
 * with all 30 as the default that is 17 parallel calls and far more chances of
 * a 429. Those chains are opt-in, per invoice, through `chains`.
 */
const DEFAULT_NON_EVM = ["bitcoin", "solana", "tron"];
export const DEFAULT_CHAINS: readonly string[] = CHAINS.filter((c) => c.family === "evm" || DEFAULT_NON_EVM.includes(c.id)).map((c) => c.id);

/** Settlement destination: Monad mainnet, chain id 143. */
export const SETTLEMENT_CHAIN = "monad";
