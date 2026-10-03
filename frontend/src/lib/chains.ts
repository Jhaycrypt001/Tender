/**
 * Display names for chain ids.
 *
 * ⚠️ `ChainId` is an OPEN union in the contract — the backend may send a chain
 * this list has never heard of, and it must still render as something a human
 * can read rather than as a raw lowercase wire id. Hence the capitalising
 * fallback instead of a `Record<ChainId, string>`, which would look safer and
 * would in fact just render `undefined` for anything new.
 *
 * This lives here rather than beside one screen because BOTH the buyer's
 * checkout and the merchant's invoice detail render chain names, and they
 * drifted once already: the buyer saw "Bitcoin" while the merchant saw
 * "bitcoin" on the same invoice.
 */
const CHAIN_LABEL: Record<string, string> = {
  // EVM: one shared deposit address across all of these.
  ethereum: "Ethereum",
  base: "Base",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  polygon: "Polygon",
  bnb: "BNB Chain",
  avalanche: "Avalanche",
  monad: "Monad",
  gnosis: "Gnosis",
  scroll: "Scroll",
  berachain: "Berachain",
  plasma: "Plasma",
  xlayer: "X Layer",
  adi: "ADI",
  // Everything else: one address per chain.
  bitcoin: "Bitcoin",
  solana: "Solana",
  tron: "Tron",
  near: "NEAR",
  sui: "Sui",
  aptos: "Aptos",
  ton: "TON",
  xrp: "XRP",
  cardano: "Cardano",
  dogecoin: "Dogecoin",
  litecoin: "Litecoin",
  bitcoincash: "Bitcoin Cash",
  zcash: "Zcash",
  starknet: "Starknet",
  aleo: "Aleo",
  dash: "Dash",
};

export function chainLabel(id: string): string {
  return CHAIN_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Every chain the backend accepts, in display order. */
export const CHAIN_IDS: readonly string[] = Object.keys(CHAIN_LABEL);

/**
 * What an invoice accepts when the merchant does not choose: every EVM chain
 * (they share ONE deposit address, so they cost nothing extra) plus Bitcoin,
 * Solana and Tron. Mirrors `DEFAULT_CHAINS` in `backend/src/aurora/chains.ts`.
 *
 * Every other chain is its own deposit address, minted one at a time, so each
 * one ticked adds roughly a second to creating the invoice. That is why they
 * are offered but not pre-ticked.
 */
export const DEFAULT_CHAIN_IDS: ReadonlySet<string> = new Set([
  "ethereum", "base", "arbitrum", "optimism", "polygon", "bnb", "avalanche",
  "monad", "gnosis", "scroll", "berachain", "plasma", "xlayer", "adi",
  "bitcoin", "solana", "tron",
]);
