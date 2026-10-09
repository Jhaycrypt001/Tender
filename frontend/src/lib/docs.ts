/** Docs page content. The endpoints, states and webhook events listed here are
 *  the ones the backend implements (backend/docs/openapi.json is the full
 *  reference). The sample ids, tokens and addresses in the request and response
 *  examples are illustrative, not real records. */

export const docs = {
  eyebrow: "Documentation",
  heading: "Start accepting any coin",
  intro:
    "Three calls take you from nothing to a settled payment. Create an invoice, show your buyer the checkout, and listen for the webhook that tells you the money landed.",

  quickstart: {
    title: "Quickstart",
    body: "Create an invoice with the amount you want and the order reference from your own system. Tender mints a deposit address on every chain you accept and hands back a public token for the checkout page.",
    request: `curl -X POST $TENDER_API_URL/v1/invoices \\
  -H "Authorization: Bearer $TENDER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount_expected": "49.00",
    "currency": "USD",
    "reference": "order_8842",
    "redirect_url": "https://yourstore.com/thanks"
  }'`,
    response: `{
  "id": "inv_2p9xQ4",
  "token": "chk_7Fk2mD9sLq",
  "status": "PENDING",
  "amount_expected": "49.00",
  "currency": "USD",
  "expires_at": "2026-09-24T14:32:00Z",
  "addresses": [
    { "chain": "bitcoin", "address": "bc1q9x…4de03" },
    { "chain": "solana",  "address": "7Fk2…Lq9s" },
    { "chain": "base",    "address": "0x7c2f91…a4de03" }
  ]
}`,
    note: "Send the buyer to {your Tender site}/pay/{token}. The token is not the invoice id. It carries nothing private, so it is safe in a URL.",
  },

  endpoints: {
    title: "API reference",
    body: "Merchant routes authenticate with your API key. Public routes are what the checkout page calls and need no auth.",
    groups: [
      {
        label: "Merchant",
        auth: "Authorization: Bearer <api_key>",
        rows: [
          {
            method: "POST",
            path: "/v1/invoices",
            desc: "Create an invoice. Not idempotent: a retried request creates a second invoice, so store the id from the first response before retrying.",
          },
          {
            method: "GET",
            path: "/v1/invoices/:id",
            desc: "Fetch one invoice with its addresses and payments.",
          },
          {
            method: "GET",
            path: "/v1/invoices",
            desc: "List invoices, filtered by status or date. Paginated.",
          },
          {
            method: "POST",
            path: "/v1/invoices/:id/cancel",
            desc: "Cancel an invoice that has not yet been paid.",
          },
          {
            method: "GET",
            path: "/v1/merchant",
            desc: "Your settlement address, settlement asset and webhook URL.",
          },
          {
            method: "PATCH",
            path: "/v1/merchant",
            desc: "Update settlement address, settlement asset or webhook URL.",
          },
        ],
      },
      {
        label: "Public",
        auth: "No authentication, safe to call from the browser",
        rows: [
          {
            method: "GET",
            path: "/public/invoices/:token",
            desc: "The invoice, its addresses and its status. No merchant data.",
          },
          {
            method: "GET",
            path: "/public/invoices/:token/events",
            desc: "Server-sent events. Pushes every status change as it happens.",
          },
          {
            method: "GET",
            path: "/public/chains",
            desc: "Supported chains, assets and estimated settlement times.",
          },
          {
            method: "POST",
            path: "/public/invoices/:token/submit-tx",
            desc: "Optional. The buyer pastes a tx hash and detection speeds up.",
          },
        ],
      },
    ],
  },

  states: {
    title: "Invoice states",
    body: "An invoice is the thing your system cares about. These are every state it can reach, and the six terminal ones are marked. Once an invoice is terminal it will never move again.",
    rows: [
      {
        name: "PENDING",
        terminal: false,
        desc: "Created, addresses minted, nothing received yet.",
      },
      {
        name: "DETECTED",
        terminal: false,
        desc: "A deposit is visible on the source chain but has not settled.",
      },
      {
        name: "SETTLED",
        terminal: true,
        desc: "The full amount landed at your address in your chosen asset.",
      },
      {
        name: "OVERPAID",
        terminal: true,
        desc: "Settled, and more came in than was owed. The excess is recorded.",
      },
      {
        name: "UNDERPAID",
        terminal: true,
        desc: "Less than the amount arrived before the invoice closed. What arrived reached your address — see the invoice's payments.",
      },
      {
        name: "EXPIRED",
        terminal: true,
        desc: "The deadline passed with nothing received.",
      },
      {
        name: "CANCELLED",
        terminal: true,
        desc: "You cancelled it before it was paid.",
      },
      {
        name: "NEEDS_RECOVERY",
        terminal: true,
        desc: "A deposit succeeded but the onward settlement failed. This one is not auto-refunded. See below.",
      },
    ],
    callout: {
      title: "Why NEEDS_RECOVERY exists",
      body: "Failures before the deposit lands are refunded for you. A failure after it lands is not, and recovery is explicit. Most processors hide this behind a generic error; Tender gives it a state so your support team can see it and act on it.",
    },
  },

  webhooks: {
    title: "Webhooks",
    body: "Every state change posts to your endpoint, signed and timestamped. Delivery is at-least-once, so dedupe on the event id. The deposit events report money sent straight to your deposit address, with no invoice: their data carries payment_id, tx_hash, from_chain, amount_in and amount_settled instead of invoice fields.",
    events: [
      "invoice.detected",
      "invoice.settled",
      "invoice.underpaid",
      "invoice.overpaid",
      "invoice.expired",
      "invoice.needs_recovery",
      "deposit.settled",
      "deposit.failed",
    ],
    payload: `{
  "id": "evt_4mK8xQ",
  "event": "invoice.settled",
  "created_at": "2026-09-24T14:12:41Z",
  "data": {
    "invoice_id": "inv_2p9xQ4",
    "reference": "order_8842",
    "status": "SETTLED",
    "amount_expected": "49.00",
    "amount_settled": "49.00",
    "from_chain": "bitcoin",
    "settled_at": "2026-09-24T14:12:39Z"
  }
}`,
    verify: `import { createHmac, timingSafeEqual } from "node:crypto";

// headers: X-Tender-Signature-V2 and X-Tender-Timestamp.
// Verify against the RAW body: parsing first changes the bytes.
export function verify(rawBody: string, signature: string, timestamp: string, secret: string) {
  // Reject replays: the timestamp is signed, so it cannot be faked.
  if (!/^\\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = "sha256=" + createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest("hex");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}`,
    note: "Use X-Tender-Signature-V2: it signs the timestamp together with the body, so a delivery older than five minutes can be rejected safely. Each retry is re-signed with a fresh timestamp. The older X-Tender-Signature (body only) is still sent for existing integrations.",
  },

  faq: {
    title: "Before you integrate",
    items: [
      {
        q: "Do I need MON to receive payments?",
        a: "No. Neither you nor your buyer ever needs MON, the settlement chain's gas token. Your buyer still pays the ordinary network fee of the chain they send from, as with any transfer.",
      },
      {
        q: "How long are deposit addresses valid?",
        a: "Addresses are permanent. The expiry belongs to the invoice, not the address, which is why an invoice can expire while its address stays live.",
      },
      {
        q: "What happens if a buyer pays twice?",
        a: "Each deposit is processed independently. The first settles the invoice; the second is recorded and reported as an overpayment.",
      },
    ],
  },

  cta: {
    heading: "Ready to start?",
    body: "Create your first invoice in under five minutes. No sales call, no contract.",
    primary: { label: "Get started", href: "#get-started" },
    secondary: { label: "Back to home", href: "/" },
  },
} as const;
