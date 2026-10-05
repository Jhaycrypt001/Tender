# Ask Tender — the backend half

The dashboard now has an **Ask** assistant: a button in the header (the little
sand mascot) opens a full-screen chat over whatever screen the merchant is on.
The frontend is finished and live. This doc is the one piece left for the
backend: **one route that answers a free-form question.**

Until that route exists nothing is broken. The frontend already handles its
absence, and the four suggested questions keep working from live payments.

---

## What already works without you

| Question | Who answers it |
|---|---|
| "How much have I been paid?" | frontend, from `GET /v1/payments` |
| "Is anything on its way right now?" | frontend, from `GET /v1/payments` |
| "Is anything stuck and waiting on me?" | frontend, from `GET /v1/payments` |
| "What went back to buyers?" | frontend, from `GET /v1/payments` |
| **anything the merchant types** | **`POST /v1/assistant/ask` ← this doc** |

The suggested questions are matched exactly, never by keyword, so they never
reach your route. Everything typed does.

While the route is missing (404), the merchant sees:

> I can only answer the suggested questions for now. The Tender assistant that
> reads free-form questions isn't connected yet. Pick one of the suggestions
> below and I'll answer it from your live payments.

So you can ship this whenever it's ready. There's no flag to flip on the frontend.

---

## The contract

```
POST /v1/assistant/ask
Authorization: Bearer <TENDER_PLATFORM_KEY>
X-Tender-Merchant: <merchant id>
Content-Type: application/json

{ "question": "Which chain do most of my buyers pay from?" }
```

```
200 OK
{ "answer": "Most of your buyers pay from Solana: 14 of your last 20 payments." }
```

- **Register it inside the existing `requireMerchant` scope** in `src/app.ts`,
  next to `dashboardRoutes`. Auth is exactly the same as every other dashboard
  route. Get the merchant with `merchantOf(req)` and **never take a merchant id
  from the body.**
- `question` is a string, 1–200 characters. The frontend trims it and caps it
  at 200, but validate anyway (zod, like the other routes).
- `answer` is **markdown, limited to three things**: `**bold**`, `` `inline code` ``
  and lists whose lines start with `- `. No headings, tables, code blocks, links
  or images. The backend reduces every answer to that subset before it leaves
  the server (`limitMarkdown`), and the dashboard renders only that subset
  (`frontend/src/lib/safe-markdown.ts`): bold and code get styled, anything else
  shows as plain text. Keep it short, roughly 1–4 sentences and under ~120 words.

### Errors: what the merchant sees for each

The frontend maps your status codes like this (`frontend/src/lib/api/client.ts`):

| You return | Merchant sees |
|---|---|
| `404` (route not registered) | the "isn't connected yet" message above |
| `429` | "You're asking faster than I can answer. Give it a few seconds and try again." |
| `400` validation | "I couldn't reach the Tender assistant." + your `message` |
| `5xx` / timeout | "I couldn't reach the Tender assistant." + your `message` |

Use the existing `ApiError` so the body is the usual `{ error: { code, message } }`.
Keep `message` human-readable, because it's shown to the merchant as-is.

### ⚠️ The 15-second budget

The frontend aborts any API call after **15 s** (`TIMEOUT_MS` in `client.ts`).
The whole thing has to fit inside that: model call, tool calls, second model
call. Aim for **under 10 s**, give the model call its own timeout of about 12 s,
and if it runs out, return a `504` with a short message rather than letting the
socket hang.

---

## Where the LLM key goes

**Built, 2026-10-05.** The provider is **Google Gemini**, called over plain REST
(no SDK). Backend env only:

| Var | Default | |
|---|---|---|
| `GEMINI_API_KEY` | none | Unset means the route is **not registered**: a 404, and the dashboard shows its "not connected" message |
| `ASSISTANT_MODEL` | `gemini-3.1-flash-lite` | `gemini-3.1-flash` does not exist for our key; this is the closest |
| `ASSISTANT_FALLBACK_MODEL` | `gemini-2.5-flash` | Tried **once** if the main model answers 429/5xx or cannot be reached. Empty disables it |

- Never on Vercel and never `NEXT_PUBLIC_`. The frontend only talks to our API.
- The key travels in the `x-goog-api-key` header, never in a URL or log line.
- A rejected request (bad key, bad input) is **not** retried on the backup model.

---

## How to build it (suggested shape)

```
src/routes/assistant.ts            validate → service → { answer }
src/services/assistant.service.ts  the model call + tool loop
```

### 1. Give the model tools, not data dumps

Don't paste the merchant's whole history into the prompt. Give the model a few
**read-only tools** that call the services you already have, and let it ask
for what it needs:

| Tool | Backed by | Returns |
|---|---|---|
| `list_payments` `{status?, from_chain?, since?, limit≤100}` | the same query as `GET /v1/payments` | rows: status, from_chain, amount_in, amount_settled, settled_at |
| `get_balance` `{}` | `balance(db, merchant)` | the same as `GET /v1/merchant/balance` |
| `list_invoices` `{status?, since?, limit≤100}` | the invoice service | rows: status, amount_expected, currency, created_at |
| `sum_settled` `{since?, from_chain?}` | **your code**, not the model | an exact total as a decimal string |

Rules for every tool:

1. **Scoped to `merchantOf(req).id`, always.** The tool takes no merchant id
   argument at all, so the model *cannot* ask about another merchant even if
   the question tells it to. This is the important one.
2. **Read-only.** No tool creates, cancels, refunds or withdraws. If the
   merchant asks the assistant to *do* something, it says where in the
   dashboard to do it.
3. **Do the maths in code.** Models are bad at adding 40 decimals. Any total,
   count or average comes from `sum_settled`-style tools using `Decimal` from
   `src/lib/money.ts`, summing **`amount_settled` only**, the same as the
   frontend's "How much have I been paid?" (`frontend/src/lib/ask.ts`). The
   model only *phrases* the number.
4. Return only fields the merchant can already see in their dashboard. No
   buyer `sender` identifiers, no internal ids, no raw Aurora payloads.

### 2. The system prompt

Something like:

> You are Tender's assistant inside a merchant's dashboard. Answer questions
> about this merchant's payments, invoices and balance using only the tools
> provided. Never guess a number: if a tool didn't return it, say you can't
> see it. Amounts are exact decimal strings; quote them as given with their
> asset. Answer in 1–4 sentences. Markdown is limited to **bold**, `inline code` and "- " lists. If asked to take an
> action (refund, withdraw, cancel), explain where in the dashboard to do it;
> you cannot do it yourself. If the question is not about their Tender account,
> say briefly that you can only help with their Tender payments.

### 3. The loop

Call the model with the question and the tools. While it returns tool calls,
run them (scoped to the merchant) and send the results back. Stop at the first
text answer, or after **4 rounds**: if it's still calling tools by then, return
"That one needs more digging than I can do here. Try narrowing it down." Then
return `{ answer }`.

### 4. Limits

- **Rate limit** the route on its own, tighter than the rest. Something like
  10/min per merchant through the existing `registerRateLimits` setup is plenty.
  A model call costs money; a list call doesn't.
- `max_tokens` around 400 on the final answer.
- **Log** the merchant id, latency, tool names called and token usage.
  **Don't log** the question or answer text at `info`, since it's the
  merchant's financial data.

---

## Testing it end to end

1. Set `GEMINI_API_KEY` in the backend env and restart. The route now exists.
2. Quick check without the frontend:
   ```bash
   curl -s -X POST "$API/v1/assistant/ask" \
     -H "Authorization: Bearer $TENDER_PLATFORM_KEY" \
     -H "X-Tender-Merchant: <a merchant id>" \
     -H "Content-Type: application/json" \
     -d '{"question":"How many payments came from Solana this week?"}'
   ```
3. In the dashboard: Ask (header mascot) → type any question → the answer animates in.
4. Things worth a vitest each:
   - tools never return another merchant's rows (seed two merchants, ask as one);
   - `sum_settled` matches the frontend's "How much have I been paid?" figure exactly;
   - no key → route is 404;
   - a markdown image, link or raw HTML in the model's answer never reaches the merchant;
   - a model timeout → 504 with a readable message, well inside 15 s.

## Frontend files, for reference (don't need changing)

| File | What it does |
|---|---|
| `frontend/src/app/app/(dash)/ask/actions.ts` | server action: suggested questions answered locally, everything else → `POST /v1/assistant/ask` |
| `frontend/src/lib/ask.ts` | the four suggested questions + the exact BigInt total |
| `frontend/src/components/ask/*` | the overlay, mascot intro, provider |
| `frontend/src/components/ui/ai-thinking-orb.tsx` | the chat input / thinking / answer animation |
