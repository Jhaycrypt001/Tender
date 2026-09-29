"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy to clipboard, with the confirmation the merchant needs.
 *
 * ⚠️ A copy button that gives no feedback gets pressed repeatedly, and the
 * merchant never learns whether it worked — so the label changes and changes
 * back. `navigator.clipboard` fails on insecure origins and when permission is
 * refused; that is caught and reported rather than silently doing nothing,
 * because the value is always selectable as text beside it.
 */
export function CopyValue({
  value,
  label = "Copy",
  className = "",
  tone = "paper",
}: {
  value: string;
  label?: string;
  className?: string;
  /** `ink` when the button sits on a dark surface, where the grey hairline vanishes. */
  tone?: "paper" | "ink";
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("done");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }, [value]);

  return (
    <button
      type="button"
      onClick={copy}
      // Announced to a screen reader when it changes, so the confirmation is
      // not purely visual.
      aria-live="polite"
      className={`shrink-0 rounded-full border px-3.5 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.1em] transition-colors ${
        tone === "ink"
          ? "border-paper/20 text-paper/60 hover:border-paper/45 hover:text-paper"
          : "border-line text-mute hover:border-mute/50 hover:text-ink"
      } ${className}`}
    >
      {state === "done" ? "Copied" : state === "failed" ? "Select it" : label}
    </button>
  );
}
