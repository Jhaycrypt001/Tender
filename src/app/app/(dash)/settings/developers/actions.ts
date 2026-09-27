"use server";

import { revalidatePath } from "next/cache";
import { testWebhook, updateMerchant } from "@/lib/api/merchant";

/**
 * Developer settings writes.
 *
 * Only the webhook endpoint is editable here. API keys are NOT: see the note
 * in `page.tsx` — there is no key endpoint in the §5 contract, and inventing
 * a client-side key would be worse than showing none.
 */

export type WebhookState = {
  fields?: Record<string, string>;
  message?: string;
  ok?: string;
  values?: Record<string, string>;
};

/**
 * A webhook URL, checked for shape only.
 *
 * ⚠️ HTTPS is required and enforced here as well as server-side. A webhook
 * body carries payment amounts and invoice references, and the signature
 * header proves who sent it but does not encrypt anything — over plain HTTP
 * that payload is readable by anyone on the path.
 *
 * SSRF is the backend's call, not this form's: blocking private and loopback
 * ranges has to happen where the request is actually made, because a hostname
 * that resolves publicly now can resolve to 127.0.0.1 later. Checking it here
 * would only be theatre.
 */
function checkUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "Enter a full URL, including https://";
  }
  if (parsed.protocol !== "https:") {
    return "Must be https. Payment data should not travel over plain http.";
  }
  return null;
}

export async function saveWebhookAction(
  _prev: WebhookState,
  form: FormData,
): Promise<WebhookState> {
  const url = String(form.get("webhook_url") ?? "").trim();
  const values = { webhook_url: url };

  // An empty field is a deliberate "turn it off", not a validation failure.
  if (url) {
    const problem = checkUrl(url);
    if (problem) return { values, fields: { webhook_url: problem } };
  }

  const result = await updateMerchant({ webhook_url: url });

  if (!result.ok) {
    const { error } = result;
    if (error.kind === "not_configured") {
      return {
        values,
        message:
          "The webhook endpoint cannot be saved yet — the Tender API is not connected in this environment.",
      };
    }
    if (error.fields && Object.keys(error.fields).length > 0) {
      return { values, fields: error.fields, message: error.message };
    }
    return { values, message: error.message };
  }

  revalidatePath("/app/settings/developers");

  return {
    ok: url
      ? "Endpoint saved. Send a test event to check it answers."
      : "Endpoint cleared. Tender will stop sending events.",
  };
}

export type TestState = { error?: string; ok?: string };

/** Fire one real event at the saved endpoint and report what came back. */
export async function testWebhookAction(
  _prev: TestState,
  _form: FormData,
): Promise<TestState> {
  const result = await testWebhook();

  if (!result.ok) {
    if (result.error.kind === "not_configured") {
      return {
        error:
          "Test events cannot be sent yet — the Tender API is not connected in this environment.",
      };
    }
    return { error: result.error.message };
  }

  // The API reports whether the endpoint ANSWERED, which is not the same as
  // the request having been sent. Both outcomes are reported plainly; a
  // "sent!" confirmation for an endpoint that 500ed would be a lie.
  return result.data.delivered
    ? { ok: "Your endpoint answered. Deliveries should arrive normally." }
    : {
        error:
          "We sent the event but your endpoint did not answer. Check it is reachable and returns a 2xx.",
      };
}
