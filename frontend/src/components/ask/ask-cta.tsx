"use client";

import { CTA_CLASS } from "@/components/dash/cta";
import { useAsk } from "./ask-provider";
import { Mascot } from "./mascot";

/** The home page's Ask action: opens the assistant in place, like the nav button. */
export function AskCta() {
  const { open } = useAsk();
  return (
    <button
      type="button"
      onClick={open}
      aria-haspopup="dialog"
      className={`${CTA_CLASS} border border-line bg-paper text-ink hover:border-ink/35`}
    >
      <Mascot className="h-[1.125rem] w-[1.125rem]" />
      Ask
    </button>
  );
}
