"use client";

import { useState } from "react";
import { Action } from "@/components/dash/action";
import { NfcWrite } from "@/components/dash/nfc-write";
import { QRCode } from "@/components/pay/qr";

/**
 * In-person tools for one reusable link: a QR to print, and an NFC sticker to
 * write.
 *
 * A link is the right thing to put on a sticker or a printed sign because it
 * never runs out: every customer who scans or taps it gets their own fresh
 * invoice. A single invoice's link would be spent after the first payment.
 *
 * Collapsed by default: most links are shared in chats, and the list should
 * not grow a QR per row for merchants who never sell in person.
 */
export function LinkTools({ url, label }: { url: string; label: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div>
        <Action onClick={() => setOpen(true)}>Scan &amp; tap to pay</Action>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-stone/50 p-4 sm:flex-row sm:items-start">
      <div className="shrink-0 self-start rounded-2xl border border-line bg-paper p-3">
        <QRCode value={url} size={148} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <p className="text-[0.8125rem] leading-relaxed text-mute">
          Print this code or put the link on an NFC sticker at your counter, on a
          menu or on a stall. Every customer who scans or taps it gets their own
          invoice for <span className="text-ink">{label}</span>.
        </p>
        <NfcWrite url={url} label="Write to NFC sticker" />
        <div>
          <Action onClick={() => setOpen(false)}>Hide</Action>
        </div>
      </div>
    </div>
  );
}
