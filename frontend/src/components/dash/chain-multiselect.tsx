"use client";

import { useEffect, useRef, useState } from "react";
import {
  DropdownChevron,
  DropdownItem,
  DropdownPanel,
} from "@/components/ui/animated-dropdown";
import { UsdMinimum } from "@/components/dash/money";

export type ChainChoice = { id: string; name: string; minimum?: string };

/**
 * "Chains accepted", as a dropdown.
 *
 * It was two stacked fieldsets of checkboxes — around thirty rows once the live
 * list loads, which pushed the submit button far below the fold and made the
 * form read as longer than it is. Collapsed, the whole form fits one screen.
 *
 * ⚠️ This form is built to post before hydration, so the chosen chains must sit
 * in the DOM as named inputs from the very first paint — not only once React
 * takes over. The panel's checkboxes unmount when it closes, and it starts
 * closed, so they cannot be the thing that carries the value. The hidden inputs
 * below are, and they are server-rendered from `defaultSelected`. A form
 * submitted before any JavaScript runs therefore posts the default chains; only
 * changing the selection needs hydration.
 */
export function ChainMultiSelect({
  id,
  options,
  defaultSelected,
  invalid,
  describedBy,
}: {
  id: string;
  options: ChainChoice[];
  /** Ticked on first render. The merchant's picks take over from there. */
  defaultSelected: ReadonlySet<string>;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [picked, setPicked] = useState<string[]>(() =>
    options.filter((o) => defaultSelected.has(o.id)).map((o) => o.id),
  );
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const listId = `${id}-list`;
  const chosen = new Set(picked);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(chainId: string) {
    setPicked((prev) =>
      prev.includes(chainId)
        ? prev.filter((x) => x !== chainId)
        : [...prev, chainId],
    );
  }

  // Named rather than counted: "Bitcoin, Solana and 3 more" tells the merchant
  // what a buyer will actually see without reopening the panel.
  const names = options.filter((o) => chosen.has(o.id)).map((o) => o.name);
  const summary =
    names.length === 0
      ? "No chains selected"
      : names.length <= 2
        ? names.join(" and ")
        : `${names[0]}, ${names[1]} and ${names.length - 2} more`;

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        // No `aria-invalid`: this trigger is a plain button, not a combobox or
        // a field, and the role does not support it. The error is announced by
        // its own `role="alert"` and tied here with `aria-describedby`.
        aria-describedby={describedBy}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border bg-paper px-3.5 py-3 text-left text-[0.9375rem] transition-colors ${
          invalid ? "border-ink" : "border-line hover:border-mute/50"
        }`}
      >
        <span className="truncate">{summary}</span>
        <span className="flex shrink-0 items-center gap-2.5">
          <span className="font-mono text-[0.6875rem] tracking-[0.08em] text-mute">
            {names.length}/{options.length}
          </span>
          <DropdownChevron open={open} className="h-4 w-4 text-mute" />
        </span>
      </button>

      <DropdownPanel
        open={open}
        id={listId}
        className="absolute inset-x-0 top-[calc(100%+0.375rem)] z-30 max-h-[20rem] overflow-y-auto"
      >
        {options.map((option) => {
          const isOn = chosen.has(option.id);
          return (
            <DropdownItem key={option.id}>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[0.9375rem] text-ink transition-colors hover:bg-stone">
                <span className="flex items-center gap-3">
                  {/* No `name`: the hidden inputs below are what the form
                      posts. Naming these too would submit every open-panel
                      chain twice. */}
                  <input
                    type="checkbox"
                    value={option.id}
                    checked={isOn}
                    onChange={() => toggle(option.id)}
                    className="size-4 accent-ink"
                  />
                  {option.name}
                </span>
                {/* Only rendered when the API supplied it. A minimum is a
                    number a merchant may quote to a buyer, so it is never
                    invented locally. No tick beside it: the checkbox already
                    says whether the row is on. */}
                {option.minimum && (
                  <span className="font-mono text-[0.6875rem] tracking-[0.08em] text-mute">
                    MIN <UsdMinimum amount={option.minimum} />
                  </span>
                )}
              </label>
            </DropdownItem>
          );
        })}
      </DropdownPanel>

      {/* What the form actually posts, open or closed. Server-rendered from
          the defaults, so a submit that beats hydration still sends chains. */}
      {picked.map((chainId) => (
        <input key={chainId} type="hidden" name="chains" value={chainId} />
      ))}
    </div>
  );
}
