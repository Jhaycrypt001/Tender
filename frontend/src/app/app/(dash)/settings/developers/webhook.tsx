"use client";

import { useActionState } from "react";
import { Card, CardHeader } from "@/components/dash/card";
import { Field } from "@/components/dash/field";
import { Submit } from "@/components/dash/action";
import {
  saveWebhookAction,
  testWebhookAction,
  type TestState,
  type WebhookState,
} from "@/app/app/(dash)/settings/developers/actions";

/**
 * The webhook endpoint, and a real test against it.
 *
 * Two forms rather than one, because "save this URL" and "send an event to
 * the URL you already saved" are different operations with different failure
 * modes. Nesting the test inside the save form would also be invalid HTML.
 */

const EMPTY_SAVE: WebhookState = {};
const EMPTY_TEST: TestState = {};

function Note({
  children,
  tone = "error",
}: {
  children: React.ReactNode;
  tone?: "error" | "ok";
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className="text-[0.875rem] leading-relaxed text-ink"
    >
      <span aria-hidden="true" className="mr-1.5 text-sand">
        &#9632;
      </span>
      {children}
    </p>
  );
}

export function WebhookPanel({ url }: { url: string }) {
  const [save, saveAction] = useActionState(saveWebhookAction, EMPTY_SAVE);
  const [test, testAction] = useActionState(testWebhookAction, EMPTY_TEST);

  const v = save.values ?? {};
  const current = v.webhook_url ?? url;

  return (
    <Card>
      <CardHeader
        label="Webhook endpoint"
        hint="Where Tender posts events. Aurora gives us no webhooks, so this is the one we run for you."
      />

      <form action={saveAction} className="flex flex-col gap-5">
        <Field
          label="Endpoint URL"
          name="webhook_url"
          type="url"
          inputMode="url"
          placeholder="https://yourshop.com/webhooks/tender"
          defaultValue={current}
          error={save.fields?.webhook_url}
          hint="Must be https. Leave blank to stop receiving events."
        />

        {save.message && <Note>{save.message}</Note>}
        {save.ok && <Note tone="ok">{save.ok}</Note>}

        <div>
          <Submit pendingLabel="Saving…">Save endpoint</Submit>
        </div>
      </form>

      {/* Only offered once something is saved — a test against an empty
          endpoint can only ever fail, and a button that cannot succeed is
          worse than no button. */}
      {current && (
        <div className="mt-5 border-t border-line pt-5">
          <form action={testAction} className="flex flex-col gap-4">
            <p className="text-[0.875rem] leading-relaxed text-mute">
              Sends one signed test event to the saved endpoint, exactly like a
              real one.
            </p>

            {test.error && <Note>{test.error}</Note>}
            {test.ok && <Note tone="ok">{test.ok}</Note>}

            <div>
              <Submit variant="quiet" pendingLabel="Sending…">
                Send a test event
              </Submit>
            </div>
          </form>
        </div>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-[0.8125rem] leading-relaxed text-mute">
          Every delivery carries{" "}
          <code className="font-mono text-[0.75rem] text-ink">
            X-Tender-Signature-V2
          </code>
          , which signs the timestamp and the raw body together. Verify it, and
          reject deliveries more than 5 minutes old, before trusting the
          payload. Dedupe on the event id: deliveries are at-least-once. See{" "}
          <a href="/docs#webhooks" className="text-ink underline decoration-sand underline-offset-4">
            the docs
          </a>
          .
        </p>
      </div>
    </Card>
  );
}
