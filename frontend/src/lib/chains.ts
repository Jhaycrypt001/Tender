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
  bitcoin: "Bitcoin",
  solana: "Solana",
  base: "Base",
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  tron: "Tron",
  monad: "Monad",
};

export function chainLabel(id: string): string {
  return CHAIN_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}
