import { Hash } from "@/components/dash/money";
import { explorerName, txUrl } from "@/lib/chains";

/**
 * A transaction hash that opens on its chain's explorer, in a new tab. Falls back to the plain
 * hash for a chain with no explorer to link to.
 *
 * `relative z-10` lifts it above a table row's whole-row link (which is an overlay), so clicking
 * the hash opens the explorer while clicking anywhere else on the row still opens the detail page.
 */
export function TxLink({
  chain,
  hash,
  full = false,
  className = "",
}: {
  /** The chain the hash is on: the buyer's chain for a payment, "monad" for a transfer. */
  chain: string | null | undefined;
  hash: string;
  /** Show the whole hash rather than a shortened one (detail pages). */
  full?: boolean;
  className?: string;
}) {
  const url = txUrl(chain, hash);
  const text = full ? <code className="break-all font-mono text-[0.75rem]">{hash}</code> : <Hash value={hash} />;
  if (!url) return <span className={className}>{text}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`View transaction on ${explorerName(chain)}`}
      title={`View on ${explorerName(chain)}`}
      className={`relative z-10 text-ink underline decoration-sand underline-offset-4 transition-colors hover:text-sand ${className}`}
    >
      {text}
    </a>
  );
}
