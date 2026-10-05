/**
 * Every word on the landing page lives here.
 * Sections import from this file so copy edits never touch JSX.
 */

export const nav = {
  links: [
    { label: "Product", href: "/#product" },
    { label: "Chains", href: "/#chains" },
    { label: "Docs", href: "/docs" },
    { label: "FAQ", href: "/#faq" },
  ],
  ghost: { label: "Docs", href: "/docs" },
  primary: { label: "Get started", href: "/app" },
} as const;

export const hero = {
  eyebrow: "Live on Monad · 30 chains",
  title: ["Get paid in any coin.", "Settle on Monad."],
  sub: "Your customer pays with whatever they already hold, even the Bitcoin they swore they'd never sell. You receive one asset on Monad. No bridges, no network switching, no gas.",
  primary: { label: "Get started", href: "/app" },
  secondary: { label: "Read the docs", href: "/docs" },
  // Goldsand runs one quiet qualifier under the button pair, not a chip row.
  note: "Non-custodial · Settles on Monad · Works with any wallet",
  strip: ["30 chains", "~0.4% fee", "Scan and send", "Non-custodial"],
} as const;

export const testimonials = [
  {
    quote:
      "We were losing customers who held everything on Solana. Tender took a day to wire up and that whole category of drop-off just disappeared.",
    name: "Daniel Okoro",
    role: "Founder, Cadence Commerce",
  },
  {
    quote:
      "One address per chain, one settlement asset. The API does exactly what the docs say it does, which is rarer than it should be.",
    name: "Priya Raghunathan",
    role: "Staff Engineer, Northwind",
  },
  {
    quote:
      "The underpayment handling is what sold me. Everyone else pretends partial payments don't happen. Tender models them.",
    name: "Marcus Feld",
    role: "Payments Lead, Orbit Retail",
  },
  {
    quote:
      "Our buyers never see a network picker. They scan, they pay, it settles. Support tickets about 'wrong chain' went to zero.",
    name: "Aisha Bello",
    role: "COO, Lumen Goods",
  },
  {
    quote:
      "Non-custodial was non-negotiable for us after Commerce shut down. Tender never touches the funds and still gives us webhooks.",
    name: "Tomas Lindqvist",
    role: "CTO, Fathom Studio",
  },
  {
    quote:
      "I integrated it on a Sunday afternoon. Create invoice, render the page, listen for the webhook. That's the whole thing.",
    name: "Grace Mwangi",
    role: "Indie developer",
  },
] as const;

/** The sticky scroll section — five beats, one visible at a time. */
export const feeScroll = {
  heading: "You're losing sales at checkout",
  beats: [
    {
      caption: "Your customer holds Bitcoin",
      sub: null,
      img: "/img/beat-1.png",
      alt: "Ink sketch of a hand holding a smartphone with a coin above the screen",
    },
    {
      caption: "Your checkout only takes one chain",
      sub: null,
      img: "/img/beat-2.png",
      alt: "Ink sketch of a hand tilting a smartphone with a single coin on its screen",
    },
    {
      caption: "So they bridge, swap, and buy gas",
      sub: null,
      img: "/img/beat-3.png",
      alt: "Ink sketch of a hand pushing a payment card into a card terminal",
    },
    {
      caption: "Most of them just leave",
      sub: "85% of crypto checkouts are abandoned",
      img: "/img/beat-4.png",
      alt: "Ink sketch of an open hand letting a smartphone fall away",
    },
    {
      caption: "Tender takes whatever they have",
      sub: "One address per chain. Settled on Monad.",
      img: "/img/beat-5.png",
      alt: "Ink sketch of a hand tapping a smartphone against a payment terminal",
      link: { label: "See how it works", href: "/#how-it-works" },
    },
  ],
} as const;

export const comparison = {
  heading: "Convert more\nwith Tender.",
  body: "Crypto checkouts lose most of their buyers, and the top cited reason is network selection confusion. Tender removes the choice entirely. Every chain is simply accepted.",
  // Completion rate, not abandonment: the winning bar has to be the tall one,
  // the way goldsand.fi charts "up to 7%" against the banks.
  bars: [
    { label: "Crypto checkout", value: "15%", pct: 15, tone: "bad", marks: "₿ Ξ ◎" },
    { label: "Card checkout", value: "30%", pct: 30, tone: "mid", marks: "▣ ▤" },
    { label: "Tender", value: "98%", pct: 98, tone: "good", marks: "◆" },
  ],
  footnote: "Checkout completion rate. Higher is better.",
} as const;

/** Left rail of three claims beside the looping wallet video — Goldsand's
 *  "Grow your wealth stress-free" block, rebuilt for Tender. */
export const showcase = {
  heading: "Get paid stress-free",
  items: [
    {
      title: "Every chain, one address",
      body: "Bitcoin, Solana, USDT on Tron, any EVM. Your buyer sends from the wallet they already have, with no bridge, no swap, no network picker.",
    },
    {
      title: "Settled in seconds, not days",
      body: "Funds land in your chosen asset on Monad and a signed webhook hits your server the moment they do. Most payments clear in under a minute.",
    },
    {
      title: "Never in our custody",
      body: "Tender never touches your money. Deposits route straight through to the address you control, so there is nothing of yours on our balance sheet.",
    },
  ],
  video: "/video/wallet-loop.mp4",
  // The poster is the clip's own final frame, so the still and the loop's
  // resting state are pixel-identical — no jump when the video starts.
  poster: "/img/wallet-still.png",
  caption: "Merchant dashboard · live balance",
} as const;

/** The stats band — four numbers with mono labels under a crosshaired rule. */
export const stats = {
  eyebrow: "Measurable difference",
  heading: "Real money. Real speed.\nReal control.",
  body: "Numbers a merchant can hold you to, not a promise about the future.",
  items: [
    { value: "<1s", label: "Settlement finality" },
    { value: "$0", label: "Gas paid by you" },
    { value: "100%", label: "Self-custody" },
    { value: "24/7", label: "Always on" },
  ],
} as const;

/** Three white cards on stone. */
export const capabilities = {
  eyebrow: "What you can do",
  heading: "Everything a checkout needs, in one integration",
  body: "One API key, one settlement address, and every chain your buyer might already be holding.",
  cards: [
    {
      title: "Accept any coin",
      body: "Bitcoin, Solana, USDT on Tron, USDC on Base, and 27 more. Your buyer pays from the wallet they already have open.",
      points: ["Scan and send", "No bridge", "No network picker"],
    },
    {
      title: "Settle in one asset",
      body: "Whatever comes in, one asset lands on Monad at the address you control. Your books stay in a single currency.",
      points: ["Monad, chain 143", "Your choice of asset", "Gas abstracted"],
    },
    {
      title: "Know the moment it lands",
      body: "A signed webhook hits your server on every state change, including the ones most processors quietly swallow.",
      points: ["Signed + timestamped", "Underpayment modelled", "Replayable"],
    },
  ],
} as const;

/** In person: the counter screen and NFC stickers, for merchants with a till. */
export const inPerson = {
  eyebrow: "In person",
  heading: "Scan or tap to pay at the counter",
  body: "Key in the amount and turn the screen round. Your customer scans the code with their camera, or taps an NFC sticker, and pays from the wallet already on their phone.",
  points: [
    {
      title: "Scan with any camera",
      body: "No app to install and nothing to connect. The phone's own camera opens the checkout.",
    },
    {
      title: "Tap an NFC sticker",
      body: "Write a sale, or a reusable link, onto a cheap NFC sticker. Any modern phone opens it with a tap, iPhone included.",
    },
    {
      title: "Paid, right on the screen",
      body: "The counter flips to Paid the moment the payment settles on Monad. Every sale is an ordinary invoice, with the same webhook.",
    },
  ],
  note: "Writing a sticker needs Chrome on Android. Reading one works on any NFC phone.",
  cta: { label: "Open the counter", href: "/app/checkout/counter" },
  example: { amount: "12.50", label: "Scan or tap to pay" },
} as const;

/** Item 4 — the dark "Pay anyone, anywhere" phone + checklist section. */
export const anywhere = {
  eyebrow: "Move money",
  heading: "Take payment from anyone, anywhere",
  body: "Your buyer opens their wallet, scans, and sends. There is no account to make, no chain to choose and no gas token to go and buy first.",
  points: [
    {
      title: "One QR, every chain",
      body: "The checkout shows the asset they picked and an address that only accepts it. Nothing to get wrong.",
    },
    {
      title: "Works with any wallet",
      body: "Tender never asks for a signature or a connect prompt, so exchange withdrawals work exactly like wallet sends.",
    },
    {
      title: "Priced for the whole minute",
      body: "The quote is held to a visible deadline. If it lapses before they send, the deposit is refunded rather than silently repriced.",
    },
    {
      title: "Underpayment is a state, not a ticket",
      body: "A short payment gets its own state and a webhook, never a support thread. A deposit below the chain minimum is refunded automatically; anything above it is yours, recorded against the invoice.",
    },
  ],
  cta: { label: "Read the docs", href: "/docs" },
  image: {
    src: "/img/pay-anywhere.png",
    alt: "A phone showing the Tender checkout: pay $49.00, a Bitcoin QR code and a 14:32 countdown",
  },
} as const;

/** Item 5 — the COMING SOON card section, ink ground with an ochre glow. */
export const card = {
  eyebrow: "Coming soon",
  heading: "Spend it without cashing out",
  body: "The Tender card draws straight from your settlement balance on Monad. Revenue arrives in crypto and leaves as an ordinary card payment, with no exchange sitting in the middle.",
  points: [
    "Draws on your settled balance",
    "Spend anywhere cards are taken",
    "Non-custodial until the moment you spend",
  ],
  cta: { label: "Join the waitlist", href: "/#get-started" },
  image: {
    src: "/img/tender-card.png",
    alt: "The Tender card, matte black with an ochre edge, half out of its sleeve",
  },
} as const;

/** Item 6 — the dark settle · live band. */
export const settleLive = {
  tabs: ["Settle", "Live"],
  eyebrow: "Settle · Live",
  heading: "Money that shows up while you are still looking at it",
  body: "Most payments clear in under a minute. You watch the invoice move from detected to settled on the same screen your customer is standing in front of.",
  stat: { value: "~40s", label: "Median time to settled" },
  cta: { label: "Get started", href: "/app" },
  image: {
    src: "/img/settle-live.png",
    alt: "A settlement card showing a payment moving from detected to settled on Monad",
  },
} as const;

export const howItWorks = {
  heading: "Three calls, start to settled",
  steps: [
    {
      n: "01",
      title: "Create an invoice",
      body: "One POST with an amount and your order reference. Tender mints a deposit address on every chain you accept.",
    },
    {
      n: "02",
      title: "Buyer pays anything",
      body: "They scan a QR with the wallet they already use. It works from any wallet or exchange, with no bridge, no network switch and no gas token.",
    },
    {
      n: "03",
      title: "Settled on Monad",
      body: "Funds arrive at your address in your chosen asset. A signed webhook hits your server the moment it lands.",
    },
  ],
} as const;

export const abandonment = {
  heading: "Checkout friction is eating your revenue",
  body: "Every chain you don't accept is a customer who can't pay you. See what that costs over a year.",
  chartLabels: { left: "Monthly volume", right: "Projected over 12 months" },
  without: { label: "Without Tender", value: "$180K" },
  with: { label: "With Tender", value: "$1.2M" },
  disclaimer:
    "Illustrative figures based on a $100K monthly checkout volume, comparing an 85% abandonment rate against under 2%. Results vary by business.",
} as const;

/**
 * ⚠️ Exactly the chains Aurora's persistent-deposit-address API accepts as
 * `depositChain` (checked 2026-09-29), minus Stellar, whose deposits need a
 * memo the checkout has nowhere to show. Aurora's marketing page lists more
 * (Hyperliquid, Robinhood, Aurora itself), but those cannot be deposited to
 * through the API Tender uses, so they are not claimed here. Change this list
 * only alongside `backend/src/aurora/chains.ts` and `src/lib/chains.ts`.
 */
export const chains = {
  heading: "Thirty chains. One integration.",
  body: "Your customer pays from the chain they already hold. Every one of these settles to the same address on Monad.",
  list: [
    "Bitcoin",
    "Ethereum",
    "Solana",
    "Monad",
    "Base",
    "Arbitrum",
    "Optimism",
    "Polygon",
    "BNB Chain",
    "Avalanche",
    "Tron",
    "NEAR",
    "Sui",
    "Aptos",
    "TON",
    "XRP",
    "Cardano",
    "Dogecoin",
    "Litecoin",
    "Bitcoin Cash",
    "Zcash",
    "Starknet",
    "Scroll",
    "Gnosis",
    "Berachain",
    "Plasma",
    "X Layer",
    "ADI",
    "Aleo",
    "Dash",
  ],
} as const;

export const faq = {
  heading: "Frequently asked questions",
  more: { label: "View more", href: "/docs" },
  items: [
    {
      q: "Do you ever hold my funds?",
      a: "No. Tender is non-custodial. Deposits route through Aurora Intents directly to the settlement address you control on Monad. We never take custody, which means no license, no float, and nothing of yours on our balance sheet.",
    },
    {
      q: "What happens if a customer underpays?",
      a: "It's a first-class state, not an error. If less than the amount has arrived when the invoice closes, it moves to UNDERPAID and you get a webhook. A deposit below the chain minimum is refunded to the buyer automatically; anything above it reached your address, and the invoice's payments show exactly what arrived.",
    },
    {
      q: "Does my customer need to connect anything?",
      a: "Never. They see an amount and a QR code, and they send from whatever wallet or exchange they already use. There is no connect step, no signature request, and no network switching prompt.",
    },
    {
      q: "Can I take payments in person?",
      a: "Yes. The counter screen in your dashboard turns a phone, tablet or laptop into a till: key in the amount, and the customer scans the code or taps an NFC sticker, then pays from their own wallet. Writing a sticker needs Chrome on Android; any NFC phone, iPhone included, can tap it.",
    },
    {
      q: "Do I need MON to receive payments?",
      a: "No. Gas is abstracted end to end. Neither you nor your customer needs to acquire the destination chain's native token for a payment to settle.",
    },
    {
      q: "How fast do payments settle?",
      a: "Most settle within a minute of confirmation on the source chain. Confirmation time depends on the chain your customer pays from: Solana is seconds, Bitcoin is longer.",
    },
    {
      q: "What does it cost?",
      a: "Around 0.4% per transaction with no monthly fee, no setup fee, and no minimum volume. You keep the majority of the spread on every payment you process.",
    },
  ],
} as const;

export const cta = {
  heading: "Start accepting any coin today.",
  body: "Create an invoice in under five minutes. No sales call, no contract.",
  primary: { label: "Get started", href: "/app" },
  secondary: { label: "Read the docs", href: "/docs" },
} as const;

export const footer = {
  tagline: "Any coin in. One asset out.",
  blurb:
    "Tender is an any-chain crypto checkout. Your buyer pays from the wallet they already have; you are settled in one asset on Monad.",
  cta: { label: "Get started", href: "/app" },
  social: [
    { label: "GitHub", href: "#github" },
  ],
  columns: [
    {
      title: "Product",
      links: [
        { label: "Checkout", href: "/#product" },
        { label: "Chains", href: "/#chains" },
        { label: "Pricing", href: "#pricing" },
        { label: "Status", href: "#status" },
      ],
    },
    {
      title: "Developers",
      links: [
        { label: "Docs", href: "/docs" },
        { label: "API reference", href: "/docs" },
        { label: "Quickstart", href: "/docs" },
        { label: "GitHub", href: "#github" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About", href: "#about" },
        { label: "Blog", href: "/blog" },
        { label: "Contact", href: "#contact" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Terms", href: "#terms" },
        { label: "Privacy", href: "#privacy" },
      ],
    },
  ],
  note: "Tender is a non-custodial payment interface. It is not a bank and does not hold customer funds.",
} as const;
