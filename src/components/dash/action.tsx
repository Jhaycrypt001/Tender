"use client";

import { useFormStatus } from "react-dom";

/**
 * The dashboard's buttons.
 *
 * `components/button.tsx` is a `Link` — it navigates and cannot submit. Every
 * write in this dashboard goes through a form posting to a server action, so
 * those need a real `<button type="submit">`, and that is what lives here.
 *
 * ⚠️ `Submit` reads `useFormStatus`, which is why it is a separate component
 * from the form itself: the hook reports the status of the nearest ANCESTOR
 * form, so it only works from inside one. A disabled-while-pending submit is
 * not cosmetic here — double-submitting the create form is how a merchant ends
 * up with two invoices for one order, and the idempotency key on the request
 * is the second line of defence, not the first.
 */

type Variant = "primary" | "quiet" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/90 disabled:bg-ink/40",
  quiet:
    "border border-line bg-paper text-ink hover:border-mute/50 disabled:text-mute",
  // Loud on purpose, and still ink + sand: this is for destructive or
  // recovery actions, which must not look like an ordinary button.
  danger:
    "border border-ink bg-paper text-ink hover:bg-stone disabled:text-mute",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[0.875rem] transition-colors disabled:cursor-not-allowed";

export function Submit({
  children,
  /** What to say while the request is in flight. */
  pendingLabel,
  variant = "primary",
  className = "",
  name,
  value,
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: Variant;
  className?: string;
  /** Lets one form carry several submits — the action reads which one fired. */
  name?: string;
  value?: string;
  /**
   * Blocks submission when the form cannot succeed yet — nothing picked, a
   * required choice unmade. This is a courtesy, never a guarantee: the server
   * action re-checks, because a disabled attribute is one devtools edit away
   * from gone.
   */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      className={`${BASE} ${VARIANT[variant]} ${className}`}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

/** A plain button, for client-side actions that are not form submissions. */
export function Action({
  children,
  onClick,
  variant = "quiet",
  className = "",
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: Variant;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`${BASE} ${VARIANT[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
