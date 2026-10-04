"use server";

import { getMerchant } from "@/lib/api/merchant";
import { listPayments } from "@/lib/api/payments";
import { request } from "@/lib/api/server";
import { LIMIT, QUESTIONS, total, type Question } from "@/lib/ask";

/**
 * The Ask assistant's one server entry point.
 *
 * Two paths, and the split is the whole design:
 *
 * 1. A suggested question is answered HERE, from the live payments API, with
 *    the same arithmetic the /app/ask page uses. These answers are exact.
 * 2. Anything typed freely goes to the backend's assistant route
 *    (`POST /v1/assistant/ask`, see docs/ASSISTANT.md). The language model and
 *    its API key live on the backend; this file never sees either.
 *
 * ⚠️ Until that route exists, free text gets an honest "not connected" reply.
 * It is never keyword-matched onto a preset: answering "how much did I make in
 * July" with the all-time total would be a confident wrong number.
 */

/** What the assistant route returns. Mirrors docs/ASSISTANT.md. */
type AssistantReply = { answer: string };

/** Longest question accepted; matches the input's maxLength. */
const MAX_QUESTION = 200;

const NOT_CONNECTED =
  "I can only answer the suggested questions for now. The Tender assistant that reads free-form questions isn't connected yet. Pick one of the suggestions below and I'll answer it from your live payments.";

export async function askTender(input: string): Promise<string> {
  const question = String(input ?? "").trim().slice(0, MAX_QUESTION);
  if (!question) return "Ask me something about your payments.";

  const preset = findPreset(question);
  if (preset) return answerPreset(preset);

  const reply = await request<AssistantReply>("/v1/assistant/ask", {
    method: "POST",
    body: { question },
  });

  if (reply.ok) {
    const answer = reply.data?.answer?.trim();
    return answer || "The assistant returned an empty answer. Try asking again.";
  }

  // Not deployed, no API configured, or the route does not exist yet: all the
  // same thing from the merchant's side.
  if (reply.error.kind === "not_found" || reply.error.kind === "not_configured") {
    return NOT_CONNECTED;
  }
  if (reply.error.kind === "rate_limited") {
    return "You're asking faster than I can answer. Give it a few seconds and try again.";
  }
  return `I couldn't reach the Tender assistant. ${reply.error.message}`;
}

/** Exact match on a suggestion's label or slug, ignoring case and punctuation. */
function findPreset(question: string): Question | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const q = norm(question);
  return QUESTIONS.find((item) => norm(item.label) === q || item.slug === q);
}

/** Thousands-grouped, fraction truncated (never rounded), no float anywhere. */
function amountText(amount: string, maxDp = 8): string {
  const [int = "0", frac = ""] = amount.split(".");
  const grouped = (int.replace(/^0+(?=\d)/, "") || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const f = frac.slice(0, maxDp).replace(/0+$/, "");
  return f ? `${grouped}.${f}` : grouped;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

async function answerPreset(question: Question): Promise<string> {
  // The merchant is fetched only for the asset's ticker; if it fails the
  // amount is still true, so it is shown without one rather than guessed.
  const [result, merchant] = await Promise.all([
    listPayments({ ...question.query, limit: LIMIT }),
    getMerchant(),
  ]);

  if (!result.ok) return `I couldn't read your payments just now. ${result.error.message}`;

  const rows = result.data.data;
  if (rows.length === 0) return question.zero;

  const asset = merchant.ok ? (merchant.data.settlement_asset ?? "") : "";
  const sum = total(rows);
  const money = `${amountText(sum.amount)}${asset ? ` ${asset}` : ""}`;
  const n = rows.length;

  let lead: string;
  switch (question.slug) {
    case "settled":
      lead = `You've been paid ${money} across ${sum.counted} ${plural(sum.counted, "payment", "payments")}.`;
      break;
    case "in-flight":
      lead = `${n} ${plural(n, "payment is", "payments are")} on the way right now.`;
      break;
    case "needs-me":
      lead = `${n} ${plural(n, "payment is", "payments are")} stuck and waiting on you. Open ${plural(n, "it", "each one")} from Activity to retry or request a withdrawal.`;
      break;
    case "refunded":
      lead = `${n} ${plural(n, "payment went", "payments went")} back to buyers.`;
      break;
    default:
      lead = `${n} ${plural(n, "payment matches", "payments match")}.`;
  }

  const notes: string[] = [];
  // Said out loud rather than folded in: an unsettled row landed nowhere, so
  // counting it as zero would make the total look complete when it is not.
  if (question.slug === "settled" && sum.unsettled > 0) {
    notes.push(`${sum.unsettled} ${plural(sum.unsettled, "payment hasn't", "payments haven't")} settled yet and ${plural(sum.unsettled, "isn't", "aren't")} in that total.`);
  }
  if (question.slug !== "settled" && sum.counted > 0) {
    notes.push(`${money} of it has settled.`);
  }
  if (result.data.has_more) {
    notes.push(`This reads your most recent ${LIMIT} payments only, so the real figure is higher.`);
  }

  return [lead, ...notes].join(" ");
}
