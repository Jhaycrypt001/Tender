import { chains } from "@/lib/copy";

export default function Chains() {
  return (
    <section id="chains" className="section-y bg-ink text-paper">
      <div className="shell">
        <div className="max-w-[46ch]">
          <h2 className="text-balance">{chains.heading}</h2>
          <p className="mt-6 text-pretty text-paper/60">{chains.body}</p>
        </div>

        <ul className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-[20px] bg-paper/10 sm:grid-cols-3 lg:grid-cols-4">
          {chains.list.map((chain) => (
            <li
              key={chain}
              className="flex items-center gap-3 bg-ink px-5 py-4 text-[0.9375rem] text-paper/85"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper/10 font-display text-[0.8125rem] text-sand">
                {chain.charAt(0)}
              </span>
              <span className="truncate">{chain}</span>
            </li>
          ))}
          <li className="flex items-center bg-ink px-5 py-4 text-[0.9375rem] text-sand">
            + more every month
          </li>
        </ul>
      </div>
    </section>
  );
}
