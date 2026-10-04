# Welcome email — the backend half

When someone signs in to Tender for the first time, they should get one email:
their account is ready, and here is the one thing to do next.

Nothing sends email today. This doc is the whole job: **one Resend call,
triggered off a flag the code already computes.**

---

## The trigger already exists

`resolveGoogleMerchant` in `src/services/merchant.service.ts` already
distinguishes a first sign-in from a returning one:

```ts
const existing = await db.merchant.findUnique({ where: { googleSub: who.googleSub } });
if (existing) return { merchant: existing, created: false };
...
return { merchant, created: true };   // ← first ever sign-in
```

`POST /internal/merchants/resolve` already returns **201** when `created` is
true and **200** when it isn't.

So the trigger is `if (created) enqueueWelcome(merchant)`. **No "have we
emailed this person" table is needed** — `created: true` happens exactly once
per merchant, and the race path (`P2002`) correctly returns `created: false`
to the loser, so a double sign-in cannot send two emails.

⚠️ **Don't send it from the frontend.** `frontend/src/app/app/session/route.ts`
is a Vercel serverless function; it can be frozen the moment it returns a
response, so an un-awaited email there is silently lost. It also must not make
sign-in wait on Resend. The backend owns merchants and already has a durable
queue — that's where this belongs.

---

## ⚠️ What a new merchant actually has

Read this before writing any copy. A merchant created by the code above gets:

```ts
settlementAsset: "USDC",
settlementAddress: null,        // ← no payout address
settlementVerified: false,      // ← cannot be paid yet
```

**A brand-new merchant cannot receive a single payment.** They have no
settlement address, and nothing works until they set and verify one.

This is why the Tender email is *not* a copy of the Talise one. Talise is a
wallet, so their email hands the user a Sui address and says "your money lives
here." Tender is a checkout: the merchant has to tell *us* where their money
should go. Handing them an ID and saying "you're all set" would be false —
they'd try to take a payment and it would fail.

**So the email has exactly one job: get them to set their settlement address.**
That is the call to action. Everything else is secondary.

---

## The contract

Send **one** email, to `merchant.email`, when `created === true`.

| | |
|---|---|
| Subject | `You're in. Set where your money lands.` |
| From | `Tender <hello@tender-pay.com>` (see DNS below) |
| Reply-to | a real inbox you read |
| Primary CTA | `https://tender-pay.vercel.app/app/settings` — set settlement address |
| Must contain | a plain-text alternative + an unsubscribe-ish footer line |

### The card

The card in the email body holds the merchant's **ID** and their
**settlement status** — not a payment link. A payment link that can't be paid
out yet is a trap.

```
┌──────────────────────────────────────────┐
│  YOUR MERCHANT ID                        │
│  clz8a0434c907a7fd0b122c29d3             │
│                                          │
│  Settlement        Not set yet  ●        │
│  Asset             USDC on Monad         │
└──────────────────────────────────────────┘
          [ Set your payout address → ]
```

Note `merchant.id` is a **cuid** (`@default(cuid())` in `prisma/schema.prisma`),
not a prefixed id like `inv_…` or `pl_…`. It's a long opaque string. Show it in
monospace, and label it clearly, because on its own it reads like noise. It's
there so they can quote it in a support email — it is **not** a secret and not
an API key, so don't imply it is.

**Never put an API key in this email.** Keys are shown once at creation in
Settings → Developers and stored hashed (argon2). Emailing one would put a live
credential in an inbox forever.

---

## Setting it up

### 1. Resend account + DNS

Free tier is 3,000 emails/month, 100/day — far more than enough.

1. Sign up at resend.com, add the sending domain.
2. Add the DKIM + SPF records it gives you to the domain's DNS.
3. **Wait for it to verify before testing.** Sending from an unverified domain
   lands in spam or is rejected outright.

Until the domain is verified, Resend allows sending to **your own address
only** via `onboarding@resend.dev`. That's enough to develop against.

### 2. Config

In `src/config.ts`, alongside the other secrets — **optional**:

```ts
RESEND_API_KEY: z.string().min(1).optional(),
EMAIL_FROM: z.string().default("Tender <hello@tender-pay.com>"),
APP_URL: z.url().default("https://tender-pay.vercel.app"),
```

No key → no email, and sign-in still works normally. Same pattern as the
assistant route in `docs/ASSISTANT.md`. Set it in Railway only.

### 3. The job

`npm i resend`, then put the send in a **BullMQ job**, not an inline `await`:

- Resend being down must never fail or slow a sign-in.
- You already have the retry machinery for webhook deliveries; reuse it.
- Retry a few times with backoff, then give up and log. A missed welcome email
  is not worth a dead-letter alarm.

```
src/services/email.service.ts   // sendWelcome(merchant) — builds + sends
src/workers/email.worker.ts     // consumes the queue
```

In `resolveGoogleMerchant`, on the `created: true` path, enqueue and return.
Don't await the send.

⚠️ **Wrap the enqueue in try/catch.** If Redis is down, a throw there would
break sign-in itself — the one thing this feature must never do.

### 4. The HTML

Email HTML is not web HTML. Rules that actually matter in Gmail and Outlook:

- **Tables for layout**, not flexbox or grid.
- **Inline styles**, not `<style>` blocks — Gmail strips much of the latter.
- **No external CSS**, no webfonts. Use a system stack:
  `font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`.
- Width **600px max**, centred, with a fluid fallback on mobile.
- Colours by hex, not CSS variables: ink `#121111`, sand `#c48535`,
  paper `#ffffff`, stone `#f0efeb`, line `#e6e4e0`, mute `#8a8783`.
- **Always send `text:` as well as `html:`.** Resend takes both. Missing plain
  text hurts deliverability and breaks screen readers.
- The CTA is an `<a>` styled as a button — `<button>` does nothing in email.

Here is the body, ready to adapt. `{{name}}`, `{{merchantId}}` and `{{appUrl}}`
are the only substitutions. **Escape them** — a merchant's name comes from
their Google profile and goes into HTML.

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0efeb;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e6e4e0;border-radius:16px;">
      <tr><td style="padding:32px 32px 0;">
        <div style="font-size:20px;letter-spacing:-0.02em;color:#121111;">tender</div>
      </td></tr>

      <tr><td style="padding:24px 32px 0;">
        <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#c48535;">Your account is ready</div>
        <h1 style="margin:12px 0 0;font-size:32px;line-height:1.1;letter-spacing:-0.02em;color:#121111;font-weight:400;">
          You're in, {{name}}.
        </h1>
        <p style="margin:16px 0 0;font-size:15px;line-height:1.55;color:#121111;">
          Tender lets your customers pay with whatever coin they already hold, on any of 31+ chains.
          You get settled in one asset on Monad. No bridges, no network switching, no gas.
        </p>
        <p style="margin:16px 0 0;font-size:15px;line-height:1.55;color:#121111;">
          One thing before you can take your first payment: tell us where your money should land.
        </p>
      </td></tr>

      <tr><td style="padding:24px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e4e0;border-radius:12px;">
          <tr><td style="padding:18px 20px;">
            <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8a8783;">Your merchant ID</div>
            <div style="margin-top:6px;font-family:'SFMono-Regular',Consolas,monospace;font-size:13px;color:#121111;word-break:break-all;">{{merchantId}}</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px solid #e6e4e0;">
              <tr>
                <td style="padding-top:12px;font-size:13px;color:#8a8783;">Settlement address</td>
                <td style="padding-top:12px;font-size:13px;color:#c48535;text-align:right;">Not set yet</td>
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
        <a href="{{appUrl}}/app/settings"
           style="display:inline-block;background:#121111;color:#ffffff;text-decoration:none;font-size:15px;padding:13px 24px;border-radius:999px;">
          Set your payout address →
        </a>
      </td></tr>

      <tr><td style="padding:28px 32px 0;">
        <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8a8783;">Then you can</div>
        <p style="margin:10px 0 0;font-size:14px;line-height:1.7;color:#121111;">
          Charge someone standing in front of you — Pay → Counter shows a QR they scan.<br>
          Send a payment link to anyone, anywhere.<br>
          Drop a tap-to-pay sticker on your counter.<br>
          Ask your dashboard how much you've been paid, in plain English.
        </p>
      </td></tr>

      <tr><td style="padding:28px 32px 32px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#8a8783;border-top:1px solid #e6e4e0;padding-top:16px;">
          You're getting this because you signed in to Tender with this address.
          Not you? Reply and tell us — we'll remove the account.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
```

Plain-text version to send alongside:

```
You're in, {{name}}.

Tender lets your customers pay with whatever coin they already hold, on any of
31+ chains. You get settled in one asset on Monad.

One thing before your first payment: tell us where your money should land.
Set your payout address: {{appUrl}}/app/settings

Your merchant ID: {{merchantId}}
Settlement address: not set yet
Settling in: USDC on Monad

You're getting this because you signed in to Tender with this address.
Not you? Reply and tell us.
```

### 5. The call

```ts
import { Resend } from "resend";
const resend = new Resend(config.RESEND_API_KEY);

await resend.emails.send({
  from: config.EMAIL_FROM,
  to: merchant.email,
  subject: "You're in. Set where your money lands.",
  html,
  text,
});
```

⚠️ **The Resend SDK does not throw on a rejected send.** It returns
`{ data, error }`. Check `error` and throw so BullMQ retries — otherwise a
failed send looks like a success and is never retried.

⚠️ **Skip disposable addresses.** `uniqueEmail()` in `merchant.service.ts`
rewrites a colliding address to `user+<sub>@domain`. That still delivers (plus
addressing), so it's fine — but be aware the stored email may not be exactly
what the user typed.

---

## Testing

1. `RESEND_API_KEY` set, `EMAIL_FROM` left as the default `onboarding@resend.dev`
   while the domain is still verifying.
2. Sign in with a Google account that has **never** used Tender. Check the inbox.
3. Sign out and back in with the same account → **no second email**
   (`created` is false). This is the one regression that matters.
4. Unset `RESEND_API_KEY`, restart, sign in with another new account → sign-in
   still works, nothing sent, one log line.
5. Stop Redis, sign in with a new account → **sign-in still succeeds.** If it
   500s, the enqueue isn't wrapped in try/catch.
6. Open it in Gmail **and** Outlook, on desktop and phone. Outlook is where
   table-less layouts fall apart.
7. Check it isn't in spam. If it is, the DNS records aren't verified yet.

Worth a vitest: the template renders with a name containing `<` and `&`
without producing broken HTML.

---

## Later, not now

Don't build these until the welcome email is live and working:

- **First payment received** — a genuinely good email, and the data's already there.
- **Settlement address set** — confirmation, with a "you're ready" line.
- A drip sequence. Skip it. One honest email beats five nagging ones.
