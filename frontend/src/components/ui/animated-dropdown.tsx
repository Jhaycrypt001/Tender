"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { CheckIcon, ChevronDownIcon } from "@/components/dash/icons";

/**
 * The dashboard's one dropdown motion.
 *
 * Adapted from emerald-ui's Animated Dropdown (MIT): the chevron turns over,
 * the panel drops in from 10px above at 95% scale, and the rows slide in from
 * the left on a 30ms stagger. The mechanic is theirs; everything else is
 * Tender's. The original ships shadcn tokens (`bg-primary`, `border-input`,
 * `bg-accent`) that this project does not define — they would have rendered
 * as nothing — plus slate/zinc greys, a second copy of the animation library
 * under its old `framer-motion` name, and plain `<a>` rows that reload the
 * whole app on every click. So it is rebuilt on ink / stone / line, on the
 * `motion` package already installed, with the header's own Links.
 *
 * Three pieces, because the four dropdowns in the dashboard differ in what
 * they hold but not in how they move:
 *   - `DropdownChevron` — the turning chevron for any trigger
 *   - `DropdownPanel` + `DropdownItem` — the animated panel and its rows
 *   - `AnimatedSelect` — a form select built from the two, which still posts
 *     a named value so every form keeps submitting to its server action
 *
 * `reducedMotion="user"` drops the movement for anyone who asked their OS for
 * less of it; the panel then simply fades.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

export const PANEL =
  "rounded-2xl border border-line bg-paper p-1.5 shadow-[0_18px_40px_-12px_rgba(18,17,17,0.22)]";

export function DropdownChevron({
  open,
  className = "",
}: {
  open: boolean;
  className?: string;
}) {
  return (
    <motion.span
      aria-hidden="true"
      className={`inline-flex shrink-0 ${className}`}
      animate={{ rotate: open ? 180 : 0 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
    >
      <ChevronDownIcon className="h-full w-full" />
    </motion.span>
  );
}

export function DropdownPanel({
  open,
  className = "",
  children,
  id,
  role,
  label,
}: {
  open: boolean;
  /** Position and width. The look comes from `PANEL`. */
  className?: string;
  children: ReactNode;
  id?: string;
  role?: "menu" | "listbox";
  label?: string;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role={role}
            aria-label={label}
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: EASE }}
            style={{ transformOrigin: "top" }}
            className={`${PANEL} ${className}`}
          >
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
            >
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

/** One staggered row. `role="none"` keeps the menu's own items what a screen
 *  reader lands on, not this wrapper. */
export function DropdownItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      role="none"
      variants={{
        hidden: { opacity: 0, x: -20 },
        visible: { opacity: 1, x: 0 },
      }}
      transition={{ duration: 0.2, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export type SelectOption = { value: string; label: string };

/**
 * A select with the dropdown motion.
 *
 * ⚠️ The chosen value travels in a hidden input under `name`, so the form
 * posts exactly what a native `<select>` would have. Before hydration the
 * hidden input already holds `defaultValue`, so a form submitted that early
 * still sends a valid value — only picking a different one needs JavaScript.
 *
 * Keyboard follows the ARIA combobox pattern: focus stays on the trigger and
 * `aria-activedescendant` names the highlighted row. Arrows move, Home/End
 * jump, Enter or Space picks, Escape and Tab close.
 */
export function AnimatedSelect({
  id,
  name,
  options,
  defaultValue,
  invalid,
  describedBy,
  className = "",
}: {
  id: string;
  name: string;
  options: SelectOption[];
  defaultValue?: string;
  invalid?: boolean;
  describedBy?: string;
  /** Classes for the trigger, so it matches the other inputs in its form. */
  className?: string;
}) {
  const [value, setValue] = useState(
    options.some((o) => o.value === defaultValue)
      ? (defaultValue as string)
      : (options[0]?.value ?? ""),
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function show() {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function choose(i: number) {
    setValue(options[i].value);
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    const last = options.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(active);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={root} className="relative">
      <input type="hidden" name={name} value={value} />
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className={`flex items-center justify-between gap-3 text-left ${className}`}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <DropdownChevron open={open} className="h-4 w-4 text-mute" />
      </button>

      <DropdownPanel
        open={open}
        id={listId}
        role="listbox"
        className="absolute inset-x-0 top-[calc(100%+0.375rem)] z-30 max-h-[18rem] overflow-y-auto"
      >
        {options.map((option, i) => {
          const isSelected = option.value === value;
          return (
            <DropdownItem key={option.value}>
              <div
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(i)}
                // Keep focus on the trigger, so the keyboard carries on
                // working after a mouse pick.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(i)}
                className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-[0.875rem] text-ink transition-colors ${
                  i === active ? "bg-stone" : ""
                }`}
              >
                {option.label}
                {isSelected && <CheckIcon className="h-4 w-4 text-ink" />}
              </div>
            </DropdownItem>
          );
        })}
      </DropdownPanel>
    </div>
  );
}
