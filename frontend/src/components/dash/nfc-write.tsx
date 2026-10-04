"use client";

import { useEffect, useRef, useState } from "react";
import { Action } from "@/components/dash/action";
import { nfcWriteSupported, writeUrlToTag } from "@/lib/nfc";

/**
 * "Write to NFC tag" — puts a pay URL on a sticker so a buyer can tap instead
 * of scan.
 *
 * Three honest states before anything is pressed:
 *  - unknown: not mounted yet. Renders nothing that could flash and vanish.
 *  - unsupported: says WHERE writing works (Chrome on Android), and that any
 *    phone can still READ the tag once it is written. A greyed-out button with
 *    no reason would read as broken.
 *  - supported: the button.
 *
 * While waiting for a tag the write stays armed until the merchant taps one or
 * presses Cancel; unmounting aborts it, so leaving the page never leaves the
 * NFC radio listening.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "written" }
  | { kind: "error"; message: string };

const MESSAGES = {
  denied:
    "NFC is off or blocked for this site. Turn NFC on in Android settings, allow it for this page, then try again.",
  failed:
    "That tag could not be written. Hold the phone still on the sticker, or use a different one: some tags are locked read-only.",
} as const;

export function NfcWrite({
  url,
  label = "Write to NFC tag",
  hint,
}: {
  url: string;
  label?: string;
  /** Shown under the button while idle — what the tag will open. */
  hint?: string;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setSupported(nfcWriteSupported());
    return () => abort.current?.abort();
  }, []);

  // A new URL (a new sale) un-writes nothing on the tag, but "Written" would
  // now be describing the previous sale's link.
  useEffect(() => {
    abort.current?.abort();
    setPhase({ kind: "idle" });
  }, [url]);

  if (supported === null) return null;

  if (!supported) {
    return (
      <p className="text-[0.8125rem] leading-relaxed text-mute">
        <span className="text-ink">Tap to pay with an NFC sticker.</span> Writing
        a sticker needs Chrome on an Android phone: open this page there. Once
        written, any phone can tap it, iPhone included.
      </p>
    );
  }

  async function start() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: "waiting" });

    const result = await writeUrlToTag(url, controller.signal);
    if (controller.signal.aborted && !result.ok) return;
    if (result.ok) setPhase({ kind: "written" });
    else if (result.error === "cancelled") setPhase({ kind: "idle" });
    else if (result.error === "unsupported") setSupported(false);
    else setPhase({ kind: "error", message: MESSAGES[result.error] });
  }

  function cancel() {
    abort.current?.abort();
    setPhase({ kind: "idle" });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {phase.kind === "waiting" ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2.5 text-[0.875rem]" role="status">
            <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sand/60 motion-reduce:hidden" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sand" />
            </span>
            Hold the back of this phone on the sticker…
          </span>
          <Action onClick={cancel}>Cancel</Action>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Action onClick={start}>
            <NfcGlyph className="h-3.5 w-3.5" />
            {phase.kind === "written" ? "Write another tag" : label}
          </Action>
          {phase.kind === "written" && (
            <span className="text-[0.875rem]" role="status">
              <span aria-hidden="true" className="mr-1.5 text-sand">
                &#9632;
              </span>
              Written. A tap on that sticker now opens this payment.
            </span>
          )}
        </div>
      )}

      {phase.kind === "error" && (
        <p role="alert" className="text-[0.8125rem] leading-relaxed text-ink">
          <span aria-hidden="true" className="mr-1.5 text-sand">
            &#9632;
          </span>
          {phase.message}
        </p>
      )}
      {phase.kind === "idle" && hint && (
        <p className="text-[0.8125rem] leading-relaxed text-mute">{hint}</p>
      )}
    </div>
  );
}

/** The contactless mark: three widening arcs. */
export function NfcGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <path d="M7 9.5a4 4 0 0 1 0 5" />
      <path d="M10.5 7a8 8 0 0 1 0 10" />
      <path d="M14 4.5a12 12 0 0 1 0 15" />
    </svg>
  );
}
