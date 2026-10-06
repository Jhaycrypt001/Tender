/**
 * Blog posts. One source feeds three surfaces: the landing section, the /blog
 * index and each /blog/[slug] page, so a post can never appear in the list
 * without a page behind it.
 *
 * These are Tender's own essays: product reasoning and opinion. They carry no
 * invented statistics, and a figure only goes in with its source beside it.
 * `date` is an ISO string so it sorts and formats without a parser.
 */
export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readingTime: string;
  category: string;
  body: string[];
};

export const posts: Post[] = [
  {
    slug: "why-crypto-checkouts-lose-most-buyers",
    title: "Why crypto checkouts lose buyers at the network picker",
    excerpt:
      "Buyers abandon crypto checkouts for boringly consistent reasons, and the first is being asked to pick a network.",
    date: "2026-09-18",
    readingTime: "6 min read",
    category: "Research",
    body: [
      "A crypto checkout asks the buyer a question that a card checkout never asks: which network are you on?",
      "The question sounds reasonable to the engineer who wrote it. It is unanswerable for most of the people who see it. A buyer holding USDT knows they hold USDT. Whether that balance sits on Tron, Ethereum or BNB Chain is a detail their wallet has spent years hiding from them, and the checkout has just made it load-bearing.",
      "What follows is a chain of small failures. The buyer guesses. The guess is wrong, or right but expensive. They open a second tab to bridge. The bridge asks for a gas token they do not hold. Somewhere in that sequence the purchase stops being worth the effort, and the merchant never learns why, because nothing failed loudly enough to be logged.",
      "The fix is not a better network picker. It is not showing one. If the checkout accepts every chain the buyer might already hold, the question never has to be asked, and the entire failure chain below it disappears at once.",
      "That is the whole argument for Tender. We did not make the picker friendlier. We deleted it.",
    ],
  },
  {
    slug: "what-happens-when-a-customer-underpays",
    title: "What happens when a customer underpays",
    excerpt:
      "Partial payments are not an error condition. They are a normal outcome, and treating them as a support ticket is a design failure.",
    date: "2026-09-10",
    readingTime: "5 min read",
    category: "Engineering",
    body: [
      "Every payment system has to answer one awkward question: what do you do when the money that arrives is not the money you asked for? Most crypto processors answer it with silence, a stuck invoice and an email address.",
      "Underpayment happens for ordinary reasons. An exchange deducts its withdrawal fee from the amount the buyer typed. The price moved between the quote and the send. Someone typed the figure by hand and missed a decimal. None of these are fraud and none of them are rare.",
      "Tender models the short payment as a first-class invoice state rather than an exception. A deposit below the minimum is refunded by the quote deadline, the invoice moves to UNDERPAID, and your server gets a webhook saying exactly that. Your system knows what happened without anyone reading a ticket.",
      "There is a second case that matters more and is discussed less. If a deposit succeeds and the settlement step afterwards fails, there is no automatic refund, and recovery has to be explicit. We surface that as its own state, NEEDS_RECOVERY, instead of leaving the invoice sitting in limbo looking like it is still waiting.",
      "Naming the bad paths is not pessimism. It is the difference between a payment system your finance team can reconcile and one they cannot.",
    ],
  },
  {
    slug: "settling-on-monad",
    title: "Why we settle on Monad",
    excerpt:
      "A settlement chain has one job: be finished before your customer has put their phone away. Here is how we chose.",
    date: "2026-09-02",
    readingTime: "4 min read",
    category: "Product",
    body: [
      "A settlement layer is judged on a single axis: how long the merchant has to stand there not knowing whether they have been paid. Everything else is secondary to closing that window.",
      "Monad gives us sub-second finality with EVM equivalence, which means the tooling merchants already trust keeps working and a settlement is final almost as soon as it lands. The time before that, while a payment crosses chains, depends on the chain the buyer paid from, and the checkout shows an estimate for each one.",
      "The second reason is cost. Settlement that eats a visible percentage of a small payment is not settlement, it is a tax on small baskets. Fees on Monad stay low enough that a coffee-sized payment is still worth accepting, which is the test most chains quietly fail.",
      "The third is that neither side needs to hold MON. A merchant can receive their first payment without ever having acquired it, and a buyer never has to hold it either. They pay only the ordinary network fee of the chain they are sending from.",
      "The chain the buyer pays from is theirs to choose. The chain you are settled on should be boring, fast and cheap. That is the split, and it is why the two are different chains.",
    ],
  },
];

export const blog = {
  eyebrow: "Insights and updates",
  heading: "What we are learning",
  body: "Notes on crypto checkout, settlement and the parts of payments nobody writes about.",
  cta: { label: "All posts", href: "/blog" },
} as const;

export function getPost(slug: string): Post | undefined {
  return posts.find((p) => p.slug === slug);
}

/** en-GB long form, computed from the ISO date so posts never drift. */
export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
