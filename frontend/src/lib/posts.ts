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
    slug: "connecting-your-site-to-tender",
    title: "Connecting your site to Tender",
    excerpt:
      "A walk through the Developers tab: your endpoint, your keys, the webhook that tells your server a payment landed, and the signature that proves it was us.",
    date: "2026-10-11",
    readingTime: "8 min read",
    category: "Guides",
    body: [
      "Most merchants never leave the dashboard. You create an invoice, you send the link, the money arrives, you see it. That is the whole job, and for a lot of businesses it is enough.",
      "It stops being enough the moment your own site is involved. If a customer clicks Buy on a page you built, you want the invoice created without anyone opening a tab, and you want your server told the moment the payment settles, so the order ships by itself. That is what Settings, then Developers, is for. This is a walk through it.",
      "Before any of it will work, your wallet has to be verified. Signing in with Google creates one for your business, and verifying it is a single click that costs nothing: the wallet signs a message proving it is yours. Until that is done, payments cannot settle, and an invoice created against an unverified wallet will be refused rather than left to fail quietly later. Pick what you want to be paid in while you are there, USDC or USDT0.",
      "The Developers page opens with your endpoint: a Base URL and a Merchant ID, each with a copy button. The Base URL is the front half of every address your server will ever call, and the endpoint is what you add to the end of it. Base URL plus /v1/invoices is where invoices are created; Base URL plus /v1/merchant reads back your own account. That second one is the cheapest possible test of a new key, and it is the first thing you should try.",
      "A key is a long secret starting with tk_live_, and it travels in the Authorization header after the word Bearer, which is just the HTTP way of saying whoever carries this is allowed in. Four things are worth knowing about keys before you make one. It is shown exactly once, at creation, and never again, so copy it then. You can hold up to ten. You can revoke any of them instantly. And it belongs on your server and nowhere else: a key in a web page is a key your visitors can read, and anyone holding it can create and cancel invoices as you. Use a separate key for each system you connect, so revoking one does not take the others down with it.",
      "Creating an invoice has a few conventions that catch people out. The amount goes in as text, \"25.00\", not a number and not with a currency symbol in front of it. The currency is USD or USDC. The reference is your own order number and it is optional, but it is doing more work than it looks: send the same reference twice and you get the original invoice back rather than a second one. That is what idempotent means here, and it is deliberate, because retries happen and a customer being billed twice for one order is the worst outcome in the system. If you leave the reference out, we number them ORD-001 onwards.",
      "What comes back includes two identifiers, and the difference matters. The id is private and belongs to your server. The token is what the public checkout page is built from, and that is the one that goes in the link you give the customer. Never put the id in a URL a buyer can see.",
      "From there the invoice moves through a small set of states, and your integration should be built around them rather than around a timer. PENDING is created and waiting. DETECTED means a payment has been seen but has not finished arriving. SETTLED is the full amount in your wallet. OVERPAID is settled and then some. UNDERPAID means the invoice closed while short, with whatever did arrive still credited to you. EXPIRED is time running out with nothing paid, CANCELLED is you calling it off, and NEEDS_RECOVERY means the money reached our routing partner but the final delivery did not complete, so it needs a human rather than a retry.",
      "The single most important line in this whole post: ship on SETTLED, not on DETECTED. DETECTED is a sighting, not an arrival. An invoice stays open for thirty minutes, then gets a fifteen-minute grace period during which a late payment still counts, and only after that does it close for good.",
      "Which brings us to webhooks, because polling an API every few seconds to ask whether a customer has paid yet is a waste of both our time. A webhook is the other direction: we call you. Put an https address in the Webhook endpoint field and save it, and from then on your server is told when something changes. Clearing the field turns them off. There is a test button that sends a harmless webhook.test event, and you should use it before you trust the real ones.",
      "There are six events, and they map onto the states you already know: invoice.detected, invoice.settled, invoice.overpaid, invoice.underpaid, invoice.expired and invoice.needs_recovery. Creating or cancelling an invoice sends nothing, because you already know about those, you did them.",
      "Now the part that is genuinely security-critical and genuinely easy to skip. Your webhook address is a public URL. Anyone who finds it can send it a message that says invoice.settled, and if you believe it, you have just shipped goods to someone who paid nothing. The defence is the signing secret, shown once on the Developers page like a key. We combine the message with that secret using HMAC-SHA256 and put the result in a header. You repeat the same calculation on your side and compare. If they match, the message is genuinely ours and has not been altered in transit.",
      "Prefer the V2 signature. X-Tender-Signature covers the body alone; X-Tender-Signature-V2 covers the timestamp and the body together, which means it also protects against someone replaying a real message of ours from an hour ago. Build the string as the timestamp, then a full stop, then the body, hash it with your secret, and compare it against the header. Two details decide whether this actually works: use the raw body exactly as it arrived, because re-encoding the JSON changes the bytes and the hash with it, and reject anything with a timestamp older than about five minutes.",
      "If your server is down or slow, we do not give up after one try. A failed delivery is retried after thirty seconds, two minutes, ten minutes, thirty minutes, one hour, two hours, four hours and eight hours, which is nine attempts across most of a day, each signed afresh with a new timestamp. The Webhook deliveries log on the same page shows every attempt as delivered, retrying or failed, and you can filter it down to the failures when something looks wrong.",
      "That retry behaviour has a consequence worth designing for: you will sometimes receive the same event twice. The usual way it happens is that your server does the work, takes too long to answer, and we retry a delivery that in fact succeeded. If shipping is triggered blindly on receipt, that customer gets two parcels. The fix is small. Every webhook carries an event id; record the ones you have processed and do nothing when one repeats. Answer fast with a 200 and do the slow work afterwards, and the problem mostly stops happening in the first place.",
      "Rotating the signing secret is the one operation with a sharp edge. The new secret is displayed once and the old one stops working immediately, with no overlap window, so your server has to be updated in the same sitting or every signature check you run will start failing. Plan it for a quiet moment rather than discovering it mid-afternoon.",
      "Worth testing before you call it done: that /v1/merchant returns your business with your key, that a deliberately wrong key gives you a 401, that sending the same reference twice gives back one invoice rather than two, that the test webhook arrives and its signature checks out, that a small real payment reaches SETTLED, and that a duplicate webhook does not ship an order twice.",
      "The status codes are conventional, with one worth calling out. 200 is fine, 201 made something, 400 means your data was wrong and the response names the offending fields, 401 means the key is missing or revoked, 404 is not found, 429 is slow down. 409 is the interesting one: it means the request is valid but cannot be done right now, and the most common cause by a distance is an unverified wallet. If you are seeing 409 on invoice creation, go back to the first thing in this post.",
      "None of this is large. A key in a header, an invoice created from your server, a signed message back when the money lands, and a check that the message was really ours. The rest of the Developers page exists so that when something does go wrong, you can see it rather than guess at it.",
    ],
  },
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
      "Tender models the short payment as a first-class invoice state rather than an exception. The invoice moves to UNDERPAID, what did arrive is recorded against it, and your server gets a webhook saying exactly that. Your system knows what happened without anyone reading a ticket.",
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
