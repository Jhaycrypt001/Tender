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

/**
 * Where to look a transaction up, per chain: the page for one transaction hash on that chain's
 * public explorer. A payment's hash is on the BUYER's chain, a transfer's is on Monad, so each
 * link has to go to the explorer of the chain the hash belongs to. ADI has no public explorer
 * we can link to yet, so its hashes stay plain text.
 */
const TX_EXPLORER: Record<string, (hash: string) => string> = {
  monad: (h) => `https://monadvision.com/tx/${h}`,
  ethereum: (h) => `https://etherscan.io/tx/${h}`,
  base: (h) => `https://basescan.org/tx/${h}`,
  arbitrum: (h) => `https://arbiscan.io/tx/${h}`,
  optimism: (h) => `https://optimistic.etherscan.io/tx/${h}`,
  polygon: (h) => `https://polygonscan.com/tx/${h}`,
  bnb: (h) => `https://bscscan.com/tx/${h}`,
  avalanche: (h) => `https://snowtrace.io/tx/${h}`,
  gnosis: (h) => `https://gnosisscan.io/tx/${h}`,
  scroll: (h) => `https://scrollscan.com/tx/${h}`,
  berachain: (h) => `https://berascan.com/tx/${h}`,
  plasma: (h) => `https://plasmascan.to/tx/${h}`,
  xlayer: (h) => `https://www.oklink.com/xlayer/tx/${h}`,
  bitcoin: (h) => `https://mempool.space/tx/${h}`,
  solana: (h) => `https://solscan.io/tx/${h}`,
  tron: (h) => `https://tronscan.org/#/transaction/${h.replace(/^0x/, "")}`,
  near: (h) => `https://nearblocks.io/txns/${h}`,
  sui: (h) => `https://suiscan.xyz/mainnet/tx/${h}`,
  aptos: (h) => `https://explorer.aptoslabs.com/txn/${h}?network=mainnet`,
  ton: (h) => `https://tonviewer.com/transaction/${h}`,
  xrp: (h) => `https://xrpscan.com/tx/${h}`,
  cardano: (h) => `https://cardanoscan.io/transaction/${h}`,
  dogecoin: (h) => `https://blockchair.com/dogecoin/transaction/${h}`,
  litecoin: (h) => `https://blockchair.com/litecoin/transaction/${h}`,
  bitcoincash: (h) => `https://blockchair.com/bitcoin-cash/transaction/${h}`,
  zcash: (h) => `https://blockchair.com/zcash/transaction/${h}`,
  dash: (h) => `https://blockchair.com/dash/transaction/${h}`,
  starknet: (h) => `https://voyager.online/tx/${h}`,
  aleo: (h) => `https://explorer.provable.com/transaction/${h}`,
};

/** The explorer page for `hash` on `chain`, or null when there is none to link to. */
export function txUrl(chain: string | null | undefined, hash: string | null | undefined): string | null {
  if (!chain || !hash) return null;
  const build = TX_EXPLORER[chain];
  return build ? build(hash) : null;
}

/** The explorer's name, for link text and accessible labels. */
export function explorerName(chain: string | null | undefined): string {
  const url = txUrl(chain, "x");
  return url ? new URL(url).hostname.replace(/^www\./, "") : "the explorer";
}
