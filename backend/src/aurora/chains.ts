/**
 * Tender's chain names (what the wire contract uses: "bitcoin", "solana", …)
 * mapped to Aurora's short codes ("btc", "sol", …) and deposit families.
 *
 * A family is the unit Aurora mints one address for. All EVM chains share a
 * single address (verified live 2026-09-26), so they are one family, "evm".
 * Every other chain is its own family.
 *
 * Stellar is deliberately absent: its deposits need a memo, and the published
 * InvoiceAddress shape has nowhere to carry one. See BACKEND.md constraint #2a.
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

export const DEFAULT_CHAINS: readonly string[] = CHAINS.map((c) => c.id);

/** Settlement destination: Monad mainnet, chain id 143. */
export const SETTLEMENT_CHAIN = "monad";
