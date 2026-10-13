import { CHAINS } from "../aurora/chains.js";
import type { Merchant } from "../generated/prisma/client.js";

/**
 * Transactional email through Resend's REST API (no SDK: one POST, and the
 * response is checked, which the SDK makes easy to forget).
 *
 * Nothing here talks to the database. `workers/email.worker.ts` decides what to
 * send and when; this file only builds a message and delivers it.
 */

export type EmailConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
  appUrl: string;
};

export type Message = { subject: string; html: string; text: string };

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** A merchant's name comes from their profile and lands in HTML. Never interpolate it raw. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

type Row = [label: string, value: string];
type Layout = {
  /** Small caps line above the figure. */
  label: string;
  /** The one number the email is about. */
  figure: string;
  /** One line under the figure. */
  sub?: string;
  /** Two or three very short lines, each with a marker. */
  points?: string[];
  rows?: Row[];
  /** A single sentence, set apart. */
  note?: string;
  cta: { label: string; url: string };
  footer: string;
  appUrl: string;
  /** Overrides the figure's size, for a long line of text in place of a number. */
  figureSize?: number;
};

const INK = "#121111";
const MUTE = "#8a8783";
const LINE = "#e6e4e0";
const OCHRE = "#c48535";
const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

/**
 * One layout for every email: the mark, a small label, ONE large figure, at most three rows, a button.
 * Every value that came from outside (names, references, addresses) goes through escapeHtml here.
 */
function layout(l: Layout): { html: string; text: string } {
  const e = escapeHtml;
  const rows = (l.rows ?? [])
    .map(([k, v], i) => {
      const top = i === 0 ? 0 : 8;
      return `<tr><td style="padding:${top}px 0 0;font-size:13px;color:${MUTE};">${e(k)}</td><td style="padding:${top}px 0 0;font-size:13px;color:${INK};text-align:right;">${e(v)}</td></tr>`;
    })
    .join("");

  const sub = l.sub ? `\n        <div style="margin-top:8px;font-size:15px;line-height:1.4;color:${MUTE};">${e(l.sub)}</div>` : "";
  const pointsBlock = l.points?.length
    ? `\n      <tr><td style="padding:20px 32px 0;">${l.points
        .map(
          (p, i) =>
            `<div style="margin-top:${i === 0 ? 0 : 8}px;font-size:14px;line-height:1.4;color:${INK};"><span style="color:${OCHRE};">&#9632;</span>&nbsp; ${e(p)}</div>`,
        )
        .join("")}</td></tr>`
    : "";
  const rowsBlock = rows
    ? `\n      <tr><td style="padding:24px 32px 0;"><div style="border-top:1px solid ${LINE};padding-top:16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></div></td></tr>`
    : "";
  const noteBlock = l.note
    ? `\n      <tr><td style="padding:20px 32px 0;"><div style="font-size:14px;line-height:1.5;color:${INK};background:#f0efeb;border-radius:10px;padding:12px 14px;">${e(l.note)}</div></td></tr>`
    : "";

  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0efeb;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:16px;font-family:${FONT};">
      <tr><td style="padding:28px 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;"><img src="${e(l.appUrl)}/apple-icon.png" width="32" height="32" alt="Tender" style="display:block;border:0;border-radius:8px;"></td>
          <td style="vertical-align:middle;padding-left:10px;font-size:19px;letter-spacing:-0.02em;color:${INK};">tender</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px 32px 0;">
        <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${OCHRE};">${e(l.label)}</div>
        <div style="margin-top:10px;font-size:${l.figureSize ?? 48}px;line-height:1.1;letter-spacing:-0.03em;color:${INK};">${e(l.figure)}</div>${sub}
      </td></tr>${pointsBlock}${rowsBlock}${noteBlock}
      <tr><td style="padding:28px 32px 0;">
        <a href="${e(l.cta.url)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-size:15px;padding:12px 24px;border-radius:999px;">${e(l.cta.label)}</a>
      </td></tr>
      <tr><td style="padding:28px 32px 28px;">
        <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTE};border-top:1px solid ${LINE};padding-top:16px;">${e(l.footer)}</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const text = [
    l.label.toUpperCase(),
    l.figure,
    ...(l.sub ? [l.sub] : []),
    "",
    ...(l.points ?? []).map((p) => `- ${p}`),
    ...(l.points?.length ? [""] : []),
    ...(l.rows ?? []).map(([k, v]) => `${k}: ${v}`),
    ...(l.note ? ["", l.note] : []),
    "",
    `${l.cta.label}: ${l.cta.url}`,
    "",
    l.footer,
  ].join("\n");

  return { html, text };
}

/** "$1,234.50". Dollar amounts only; an invoice in another currency shows its own code. */
export function money(value: string | number | { toString(): string }, currency = "USD"): string {
  const n = Number(value.toString());
  const body = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return ["USD", "USDC", "USDT", "USDT0"].includes(currency.toUpperCase()) ? `$${body}` : `${body} ${currency}`;
}

/* -------------------------------------------------------------------------- */
/* Welcome                                                                     */
/* -------------------------------------------------------------------------- */

type WelcomeInput = Pick<Merchant, "id" | "name" | "settlementAddress" | "settlementVerified"> & { appUrl: string };

/**
 * The welcome email, built from the merchant's state at SEND time. The
 * dashboard can set and verify the payout address seconds after sign-in, so an
 * email that said "not set yet" would be wrong by the time it arrived.
 *
 * Never contains an API key: keys are shown once in Settings → Developers.
 */
export function renderWelcome(m: WelcomeInput): Message {
  const ready = m.settlementVerified && !!m.settlementAddress;
  const name = m.name.trim() || "there";
  const parts = layout({
    label: "Welcome",
    figure: `You're in, ${name}.`,
    figureSize: name.length > 14 ? 28 : 36,
    sub: "Your customers pay with whatever they hold. You get paid in one asset.",
    points: [
      `Any coin, on any of ${CHAINS.length} chains`,
      "USDC lands in your own wallet on Monad",
      "No wallet connect, no bridging, no network picker",
    ],
    rows: [
      ["Merchant ID", m.id],
      ["Payout address", ready ? shortAddress(m.settlementAddress!) : "Not set yet"],
      ["Status", ready ? "Verified" : "Not set yet"],
    ],
    cta: ready ? { label: "Create your first invoice", url: `${m.appUrl}/app/checkout/new` } : { label: "Set your payout address", url: `${m.appUrl}/app/settings` },
    footer: "You're getting this because you signed in to Tender. Not you? Reply and we'll remove the account.",
    appUrl: m.appUrl,
  });
  const text = ready ? parts.text.replace(shortAddress(m.settlementAddress!), m.settlementAddress!) : parts.text;
  return { subject: ready ? "You're in. Take your first payment." : "You're in. Set where your money lands.", html: parts.html, text };
}

/* -------------------------------------------------------------------------- */
/* Money in                                                                    */
/* -------------------------------------------------------------------------- */

/** "13 Oct, 14:35 UTC": when it happened, the same for every reader. */
export function when(d: Date): string {
  const day = d.toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const time = d.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day}, ${time} UTC`;
}

export type MoneyIn = {
  appUrl: string;
  /** When the payment settled, or the invoice closed. */
  at: Date;
  /** What this email is about. "deposit" is money sent straight to the standing address, with no invoice. */
  variant: "received" | "partial" | "over" | "short" | "deposit";
  /** This payment, as it reached the wallet. */
  amount: string;
  currency: string;
  fromChain: string;
  reference: string;
  invoiceId: string;
  /** All settled payments added up, and what the invoice asked for. Absent for a deposit. */
  received?: string;
  expected?: string;
};

const gap = (a?: string, b?: string) => Math.abs(Number(a ?? 0) - Number(b ?? 0)).toFixed(2);

/** Money arriving. One email per payment; the variant says whether the invoice is paid, part-paid, over or closed short. */
export function renderMoneyIn(d: MoneyIn): Message {
  const url = `${d.appUrl}/app/checkout/${encodeURIComponent(d.invoiceId)}`;
  const base = { appUrl: d.appUrl, footer: "One of these for every payment. You can turn them off in Settings." };
  const cur = d.currency;

  switch (d.variant) {
    case "partial":
      return {
        subject: `${money(d.received!, cur)} of ${money(d.expected!, cur)} received · ${d.reference}`,
        ...layout({
          ...base,
          label: "Part payment",
          figure: money(d.received!, cur),
          sub: `of ${money(d.expected!, cur)}`,
          rows: [
            ["Invoice", d.reference],
            ["Still to pay", money(gap(d.expected, d.received), cur)],
            ["When", when(d.at)],
          ],
          note: "Payments add up. The buyer can send the rest before it closes.",
          cta: { label: "View invoice", url },
        }),
      };
    case "over":
      return {
        subject: `Overpaid by ${money(gap(d.received, d.expected), cur)} · ${d.reference}`,
        ...layout({
          ...base,
          label: "Overpaid",
          figure: `${money(gap(d.received, d.expected), cur)} over`,
          rows: [
            ["Invoice", d.reference],
            ["Due", money(d.expected!, cur)],
            ["Received", money(d.received!, cur)],
            ["When", when(d.at)],
          ],
          cta: { label: "Refund the extra", url },
        }),
      };
    case "short":
      return {
        subject: `${d.reference} closed ${money(gap(d.expected, d.received), cur)} short`,
        ...layout({
          ...base,
          label: "Closed short",
          figure: `${money(gap(d.expected, d.received), cur)} short`,
          rows: [
            ["Invoice", d.reference],
            ["Due", money(d.expected!, cur)],
            ["Received", money(d.received!, cur)],
            ["Closed", when(d.at)],
          ],
          note: "What arrived is in your wallet. Invoice the rest, or send it back.",
          cta: { label: "View invoice", url },
        }),
      };
    case "deposit":
      return {
        subject: `Deposit received · ${money(d.amount, cur)}`,
        ...layout({
          ...base,
          label: "Deposit received",
          figure: money(d.amount, cur),
          rows: [
            ["To", "Your deposit address"],
            ["From", d.fromChain],
            ["When", when(d.at)],
          ],
          cta: { label: "View activity", url: `${d.appUrl}/app/activity` },
        }),
      };
    default:
      return {
        subject: `Received ${money(d.amount, cur)} · ${d.reference}`,
        ...layout({
          ...base,
          label: "Payment received",
          figure: money(d.amount, cur),
          sub: "Paid in full",
          rows: [
            ["Invoice", d.reference],
            ["From", d.fromChain],
            ["When", when(d.at)],
          ],
          cta: { label: "View payment", url },
        }),
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Money out                                                                   */
/* -------------------------------------------------------------------------- */

export type MoneyOut = {
  appUrl: string;
  /** When it was confirmed, or failed. */
  at: Date;
  /** "sent": it arrived. "failed": it did not. */
  variant: "sent" | "failed";
  transferId: string;
  kind: "PAYOUT" | "REFUND" | "SPLIT";
  amount: string;
  asset: string;
  /** Where it went: one entry per recipient. */
  to: Array<{ address: string; chain: string }>;
  /** Why it failed, in the words the dashboard uses. */
  reason?: string | null;
};

const KIND_LABEL = { PAYOUT: "Payment", REFUND: "Refund", SPLIT: "Split" } as const;

/** Money leaving the wallet. Always sent: it is also the merchant's alert that something moved. */
export function renderMoneyOut(d: MoneyOut): Message {
  const url = `${d.appUrl}/app/activity/sent/${encodeURIComponent(d.transferId)}`;
  const kind = KIND_LABEL[d.kind];
  const who = d.to.length === 1 ? `${shortAddress(d.to[0]!.address)} on ${d.to[0]!.chain}` : `${d.to.length} recipients`;
  const footer = "Didn't do this? Reply to this email right away.";
  const figure = money(d.amount, d.asset);

  if (d.variant === "failed") {
    return {
      subject: `${kind} not delivered · ${figure}`,
      ...layout({
        appUrl: d.appUrl,
        footer,
        label: `${kind} not delivered`,
        figure,
        rows: [
          ["To", who],
          ["When", when(d.at)],
        ],
        note: (d.reason?.trim() || "It did not reach the other chain.").slice(0, 200),
        cta: { label: "See what happened", url },
      }),
    };
  }
  return {
    subject: `${kind} sent · ${figure}`,
    ...layout({
      appUrl: d.appUrl,
      footer,
      label: `${kind} sent`,
      figure,
      rows: [
        ["To", who],
        ["When", when(d.at)],
      ],
      cta: { label: "View details", url },
    }),
  };
}

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

/**
 * Sends one message. Resend answers a rejected send with an error body rather
 * than throwing, so success is judged on the HTTP status, never on "no throw".
 */
export async function sendEmail(
  cfg: EmailConfig,
  to: string,
  message: Message,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to, ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}), subject: message.subject, html: message.html, text: message.text }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: `resend ${res.status}: ${body.message ?? "rejected"}`.slice(0, 300) };
    return { ok: true, id: body.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
