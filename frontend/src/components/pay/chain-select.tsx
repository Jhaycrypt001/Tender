"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  DropdownChevron,
  DropdownItem,
  DropdownPanel,
} from "@/components/ui/animated-dropdown";
import { UsdMinimum } from "@/components/dash/money";
import { CheckIcon } from "@/components/dash/icons";
import { chainLabel } from "@/lib/chains";

export type ChainChoice = { chain: string; minimum?: string | null };

/**
 * The buyer's chain picker, as a dropdown.
 *
 * It was a vertical list of every chain on the invoice. With ten or more
 * offered that pushed the deposit address — the one thing the buyer came for —
 * below the fold on a phone, so the screen opened on a wall of names instead of
 * something to pay. Collapsed, the choice and the address sit together.
 *
 * Built on the dashboard's dropdown primitives rather than `AnimatedSelect`,
 * because this one is controlled by the parent (picking a chain swaps the
 * address and QR beside it) and each row carries that chain's minimum. It is
 * not in a form and posts nothing.
 *
 * Keyboard follows the ARIA combobox pattern, same as `AnimatedSelect`: focus
 * stays on the trigger, `aria-activedescendant` names the highlighted row,
 * arrows move, Home/End jump, Enter or Space picks, Escape and Tab close.
 */
export function ChainSelect({
  id,
  options,
  value,
  onChange,
  disabled,
}: {
  id: string;
  options: ChainChoice[];
  value: string;
  onChange: (chain: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const selected = options.find((o) => o.chain === value);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  // An expired or settled invoice closes the list rather than leaving a panel
  // open over a chain that can no longer be paid.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function show() {
    setActive(Math.max(0, options.findIndex((o) => o.chain === value)));
    setOpen(true);
  }

  function choose(i: number) {
    onChange(options[i].chain);
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
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label="Chain to pay with"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink bg-ink px-3.5 py-3.5 text-left text-[0.9375rem] text-paper transition-opacity disabled:opacity-50"
      >
        <span className="truncate">
          {selected ? chainLabel(selected.chain) : "Choose a chain"}
        </span>
        <span className="flex items-center gap-2.5">
          {selected?.minimum && (
            <span className="font-mono text-[0.6875rem] tracking-[0.08em] text-paper/60">
              MIN <UsdMinimum amount={selected.minimum} />
            </span>
          )}
          <DropdownChevron open={open} className="h-4 w-4 text-paper/70" />
        </span>
      </button>

      <DropdownPanel
        open={open}
        id={listId}
        role="listbox"
        label="Chain to pay with"
        className="absolute inset-x-0 top-[calc(100%+0.375rem)] z-30 max-h-[18rem] overflow-y-auto"
      >
        {options.map((option, i) => {
          const isSelected = option.chain === value;
          return (
            <DropdownItem key={option.chain}>
              <div
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(i)}
                // Keep focus on the trigger, so the keyboard carries on
                // working after a mouse pick.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[0.9375rem] text-ink transition-colors ${
                  i === active ? "bg-stone" : ""
                }`}
              >
                <span className="truncate">{chainLabel(option.chain)}</span>
                <span className="flex items-center gap-2.5">
                  {/* Only rendered when the API supplied it. A minimum is a
                      number the buyer may act on, so it is never invented. */}
                  {option.minimum && (
                    <span className="font-mono text-[0.6875rem] tracking-[0.08em] text-mute">
                      MIN <UsdMinimum amount={option.minimum} />
                    </span>
                  )}
                  {isSelected && <CheckIcon className="h-4 w-4 text-ink" />}
                </span>
              </div>
            </DropdownItem>
          );
        })}
      </DropdownPanel>
    </div>
  );
}
