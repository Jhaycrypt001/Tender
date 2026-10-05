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
  const ctaUrl = ready ? `${m.appUrl}/app/checkout/new` : `${m.appUrl}/app/settings`;
  const ctaLabel = ready ? "Create your first invoice →" : "Set your payout address →";
  const lead = ready
    ? "Your payout address is set and verified, so you can take your first payment now."
    : "One thing before you can take your first payment: tell us where your money should land.";
  const status = ready ? "Verified" : "Not set yet";
  const statusColour = ready ? "#2f7d4f" : "#c48535";
  const addressLine = ready ? shortAddress(m.settlementAddress!) : "Not set yet";

  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0efeb;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e6e4e0;border-radius:16px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
      <tr><td style="padding:32px 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;"><img src="${escapeHtml(m.appUrl)}/apple-icon.png" width="36" height="36" alt="Tender" style="display:block;border:0;border-radius:9px;"></td>
          <td style="vertical-align:middle;padding-left:10px;font-size:20px;letter-spacing:-0.02em;color:#121111;">tender</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 32px 0;">
        <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#c48535;">Your account is ready</div>
        <h1 style="margin:12px 0 0;font-size:32px;line-height:1.1;letter-spacing:-0.02em;color:#121111;font-weight:400;">You're in, ${escapeHtml(name)}.</h1>
        <p style="margin:16px 0 0;font-size:15px;line-height:1.55;color:#121111;">Tender lets your customers pay with whatever coin they already hold, on any of 30 chains. You get settled in one asset on Monad. No bridges and no network switching on your side.</p>
        <p style="margin:16px 0 0;font-size:15px;line-height:1.55;color:#121111;">${lead}</p>
      </td></tr>
      <tr><td style="padding:24px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e4e0;border-radius:12px;">
          <tr><td style="padding:18px 20px;">
            <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8a8783;">Your merchant ID</div>
            <div style="margin-top:6px;font-family:'SFMono-Regular',Consolas,monospace;font-size:13px;color:#121111;word-break:break-all;">${escapeHtml(m.id)}</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px solid #e6e4e0;">
              <tr>
                <td style="padding-top:12px;font-size:13px;color:#8a8783;">Settlement address</td>
                <td style="padding-top:12px;font-size:13px;color:${statusColour};text-align:right;">${escapeHtml(addressLine)}</td>
              </tr>
              <tr>
                <td style="padding-top:6px;font-size:13px;color:#8a8783;">Status</td>
                <td style="padding-top:6px;font-size:13px;color:${statusColour};text-align:right;">${status}</td>
              </tr>
              <tr>
                <td style="padding-top:6px;font-size:13px;color:#8a8783;">Settling in</td>
                <td style="padding-top:6px;font-size:13px;color:#121111;text-align:right;">USDC on Monad</td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:24px 32px 0;">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#121111;color:#ffffff;text-decoration:none;font-size:15px;padding:13px 24px;border-radius:999px;">${ctaLabel}</a>
      </td></tr>
      <tr><td style="padding:28px 32px 0;">
        <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8a8783;">Then you can</div>
        <p style="margin:10px 0 0;font-size:14px;line-height:1.7;color:#121111;">
          Charge someone standing in front of you: Pay → Counter shows a QR they scan.<br>
          Send a payment link to anyone, anywhere.<br>
          Drop a tap-to-pay sticker on your counter.<br>
          Ask your dashboard how much you've been paid, in plain English.
        </p>
      </td></tr>
      <tr><td style="padding:28px 32px 32px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#8a8783;border-top:1px solid #e6e4e0;padding-top:16px;">You're getting this because you signed in to Tender with this address. Not you? Reply and tell us, and we'll remove the account.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const text = [
    `You're in, ${name}.`,
    "",
    "Tender lets your customers pay with whatever coin they already hold, on any of 30 chains. You get settled in one asset on Monad.",
    "",
    lead,
    `${ctaLabel.replace(" →", "")}: ${ctaUrl}`,
    "",
    `Your merchant ID: ${m.id}`,
    `Settlement address: ${ready ? m.settlementAddress : "not set yet"}`,
    `Status: ${status.toLowerCase()}`,
    "Settling in: USDC on Monad",
    "",
    "You're getting this because you signed in to Tender with this address. Not you? Reply and tell us.",
  ].join("\n");

  return { subject: ready ? "You're in. Take your first payment." : "You're in. Set where your money lands.", html, text };
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
