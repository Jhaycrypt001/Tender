"use server";

import { revalidatePath } from "next/cache";
import {
  createApiKey,
  revokeApiKey,
  rotateWebhookSecret,
  testWebhook,
  updateMerchant,
} from "@/lib/api/merchant";

/**
 * Developer settings writes: the webhook endpoint, API keys and the webhook
 * signing secret.
 *
 * ⚠️ A new key or secret is returned from its action ONCE, in that action's
 * state, and is never written anywhere else: not a cookie, not a cache, not a
 * log. The merchant copies it then or rotates again. Every action acts for the
 * signed-in merchant only, because `request()` takes the merchant from the
 * signed session, never from the form.
 */

const NOT_CONNECTED =
  "The Tender API is not connected in this environment, so this cannot be done yet.";

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
  // the request having been sent. Both outcomes are reported plainly, with
  // what actually came back; a "sent!" for an endpoint that 500ed would be a lie.
  const { delivered, status_code, error } = result.data;
  if (delivered) {
    return {
      ok: `Your endpoint answered ${status_code ?? "2xx"}. Deliveries should arrive normally.`,
    };
  }
  if (status_code !== null) {
    return {
      error: `Your endpoint answered ${status_code}, not a 2xx. Tender counts that as a failed delivery and retries real events.`,
    };
  }
  return {
    error: `Your endpoint did not answer${error ? ` (${error})` : ""}. Check it is reachable from the internet over https.`,
  };
}

/* -------------------------------------------------------------------------- */
/* API keys                                                                    */
/* -------------------------------------------------------------------------- */

export type CreateKeyState = {
  error?: string;
  /** The new key. Present in this one response only. */
  created?: { id: string; key: string; prefix: string };
};

export async function createKeyAction(
  _prev: CreateKeyState,
  _form: FormData,
): Promise<CreateKeyState> {
  const result = await createApiKey();

  if (!result.ok) {
    const { error } = result;
    if (error.kind === "not_configured") return { error: NOT_CONNECTED };
    if (error.status === 409) {
      return { error: "You already have 10 active keys. Revoke one you no longer use, then create a new one." };
    }
    return { error: error.message };
  }

  revalidatePath("/app/settings/developers");
  const { id, key, prefix } = result.data;
  return { created: { id, key, prefix } };
}

export type RevokeKeyState = { error?: string; ok?: string };

/** Key ids are opaque, but never anything other than this shape. */
const KEY_ID = /^key_[0-9A-Za-z]{1,64}$/;

export async function revokeKeyAction(
  _prev: RevokeKeyState,
  form: FormData,
): Promise<RevokeKeyState> {
  const id = String(form.get("id") ?? "");
  if (!KEY_ID.test(id)) return { error: "That key could not be identified. Reload the page and try again." };

  const result = await revokeApiKey(id);

  if (!result.ok) {
    const { error } = result;
    if (error.kind === "not_configured") return { error: NOT_CONNECTED };
    if (error.kind === "not_found") {
      revalidatePath("/app/settings/developers");
      return { error: "That key was already revoked." };
    }
    return { error: error.message };
  }

  revalidatePath("/app/settings/developers");
  return { ok: "Key revoked. Requests made with it now fail with 401." };
}

/* -------------------------------------------------------------------------- */
/* Webhook signing secret                                                      */
/* -------------------------------------------------------------------------- */

export type RotateSecretState = { error?: string; secret?: string };

export async function rotateSecretAction(
  _prev: RotateSecretState,
  _form: FormData,
): Promise<RotateSecretState> {
  const result = await rotateWebhookSecret();

  if (!result.ok) {
    if (result.error.kind === "not_configured") return { error: NOT_CONNECTED };
    return { error: result.error.message };
  }

  return { secret: result.data.webhook_secret };
}
