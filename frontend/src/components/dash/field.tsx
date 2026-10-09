import { useId } from "react";
import { AnimatedSelect } from "@/components/ui/animated-dropdown";

/**
 * Form inputs.
 *
 * Every field here is an uncontrolled native input with a `name`, because every
 * form in this dashboard submits to a server action or a route handler rather
 * than to a client state store. That keeps creating an invoice working before
 * hydration, and it is why no state library was added to this project.
 *
 * ⚠️ Errors come from the API's `ApiError.fields`, keyed by field name — the
 * server validates with the shared schema and the client renders what it says.
 * There is no second, hand-rolled validation layer to drift out of sync with it.
 *
 * The one exception to "native" is `Select`, which is the animated dropdown so
 * it matches every other dropdown in the dashboard. It still posts a named
 * value through a hidden input, so the forms above it do not know the
 * difference.
 */

function Shell({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="flex items-center gap-2 text-[0.875rem]">
        {label}
        {/* Optional is marked, not required — in a form where most fields are
            required, marking the exception is less visual noise. */}
        {!required && (
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-mute">
            Optional
          </span>
        )}
      </label>
      {children}
      {/* The hint is hidden once there is an error: two lines of small grey
          text under one input is where people stop reading either. */}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[0.8125rem] text-ink">
          <span aria-hidden="true" className="mr-1.5 text-sand">
            &#9632;
          </span>
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-[0.8125rem] leading-relaxed text-mute">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const INPUT =
  // 16px on phones: iOS Safari zooms the whole page into any input smaller than that on focus.
  "w-full rounded-xl border bg-paper px-3.5 py-2.5 text-base md:text-[0.9375rem] text-ink placeholder:text-mute/70 transition-colors";

/** Border is the only thing an error changes — the field does not turn red.
 *  The message under it is what carries the meaning. */
function border(error?: string) {
  return error ? "border-ink" : "border-line hover:border-mute/50";
}

export function Field({
  label,
  name,
  hint,
  error,
  required,
  type = "text",
  placeholder,
  defaultValue,
  /** Rendered inside the input, right-aligned — a currency ticker or a unit. */
  suffix,
  inputMode,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  required?: boolean;
  type?: "text" | "email" | "url" | "number";
  placeholder?: string;
  defaultValue?: string;
  suffix?: string;
  inputMode?: "text" | "decimal" | "numeric" | "email" | "url";
}) {
  const id = useId();

  return (
    <Shell id={id} label={label} hint={hint} error={error} required={required}>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          placeholder={placeholder}
          defaultValue={defaultValue}
          inputMode={inputMode}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={`${INPUT} ${border(error)} ${suffix ? "pr-14" : ""}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center font-mono text-[0.75rem] uppercase tracking-[0.1em] text-mute">
            {suffix}
          </span>
        )}
      </div>
    </Shell>
  );
}

/**
 * An amount input.
 *
 * Separate from `Field` because money has rules the generic input must not
 * apply: `type="number"` is avoided deliberately. A number input lets the
 * browser normalise the value, exposes scroll-to-change (which silently edits
 * an amount when someone scrolls the page), and rejects the high-precision
 * strings this product deals in. So this is a text input with a decimal
 * inputMode — the numeric keypad on a phone, no browser rewriting.
 */
export function AmountField({
  label,
  name,
  currency,
  hint,
  error,
  required,
  defaultValue,
}: {
  label: string;
  name: string;
  currency: string;
  hint?: string;
  error?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <Field
      label={label}
      name={name}
      hint={hint}
      error={error}
      required={required}
      type="text"
      inputMode="decimal"
      placeholder="0.00"
      defaultValue={defaultValue}
      suffix={currency}
    />
  );
}

export function TextArea({
  label,
  name,
  hint,
  error,
  required,
  rows = 4,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  required?: boolean;
  rows?: number;
  placeholder?: string;
  defaultValue?: string;
}) {
  const id = useId();

  return (
    <Shell id={id} label={label} hint={hint} error={error} required={required}>
      <textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`${INPUT} ${border(error)} resize-y`}
      />
    </Shell>
  );
}

export function Select({
  label,
  name,
  options,
  hint,
  error,
  required,
  defaultValue,
  onChange,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  hint?: string;
  error?: string;
  required?: boolean;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  const id = useId();

  return (
    <Shell id={id} label={label} hint={hint} error={error} required={required}>
      {/* No `required` to forward: the value always starts as one of the
          options, so the field can never post empty. */}
      <AnimatedSelect
        id={id}
        name={name}
        options={options}
        defaultValue={defaultValue}
        onChange={onChange}
        invalid={Boolean(error)}
        describedBy={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`${INPUT} ${border(error)}`}
      />
    </Shell>
  );
}

/**
 * A labelled read-only value, for detail panels.
 *
 * Not an input: this is the display half of the same visual language, so a
 * settings page can mix editable and fixed values without them looking like
 * two different systems.
 */
export function ReadOnlyField({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  /** A copy button, usually. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.875rem]">{label}</p>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-stone/60 px-3.5 py-2.5">
        <div className="min-w-0 break-all text-[0.9375rem]">{children}</div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

/**
 * A text input whose value the parent owns.
 *
 * `Field` is uncontrolled (a name and a default), which suits a form that is
 * read once on submit. The send-money screens need the value live: a balance
 * check as the amount is typed, a total across rows, an address compared with
 * the one a payment came from. Same look as `Field`, so a screen mixing the
 * two does not show two styles of input.
 */
export function ControlledField({
  label,
  value,
  onChange,
  hint,
  error,
  required,
  placeholder,
  suffix,
  inputMode,
  mono,
  disabled,
  autoComplete = "off",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  suffix?: string;
  inputMode?: "text" | "decimal" | "numeric";
  /** Addresses read better in the mono face. */
  mono?: boolean;
  disabled?: boolean;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error} required={required}>
      <div className="relative">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          disabled={disabled}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={`${INPUT} ${border(error)} ${suffix ? "pr-16" : ""} ${mono ? "font-mono text-[0.8125rem]" : ""} disabled:opacity-60`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center font-mono text-[0.75rem] uppercase tracking-[0.1em] text-mute">
            {suffix}
          </span>
        )}
      </div>
    </Shell>
  );
}
