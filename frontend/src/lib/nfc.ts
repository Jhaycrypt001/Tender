/**
 * Writing a payment URL onto an NFC tag, from the browser.
 *
 * What this is, honestly: Web NFC can READ and WRITE NFC tags (the cheap
 * NTAG213/215 stickers sold by the hundred). It cannot make a phone pretend to
 * be a card or a tag, so the merchant's phone never "becomes" the terminal.
 * The tap-to-pay model is therefore a sticker on the counter holding a URL:
 *
 *   merchant writes the pay URL onto the sticker  (Chrome on Android only)
 *   buyer taps their phone on the sticker          (any modern phone)
 *   the phone opens the checkout                   (no app, no wallet connect)
 *
 * Reading needs nothing from us: iPhones from the XS onwards and every NFC
 * Android phone open a URL tag on their own, from the lock screen. Writing is
 * the narrow part — Web NFC ships only in Chrome on Android, over HTTPS — so
 * every caller must check `nfcWriteSupported()` and say so when it is false,
 * rather than show a button that does nothing.
 *
 * Reference: https://w3c.github.io/web-nfc/
 */

/** The slice of the Web NFC API we use. Not in TypeScript's DOM lib yet. */
type NDEFRecordInit = { recordType: "url"; data: string };
type NDEFReaderLike = {
  write(
    message: { records: NDEFRecordInit[] },
    options?: { signal?: AbortSignal; overwrite?: boolean },
  ): Promise<void>;
};
type NDEFReaderCtor = new () => NDEFReaderLike;

function readerCtor(): NDEFReaderCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { NDEFReader?: NDEFReaderCtor }).NDEFReader;
  return typeof ctor === "function" ? ctor : null;
}

/**
 * Whether this browser can write a tag. False on iPhone, desktop and every
 * non-Chrome Android browser — and always false during server rendering, so
 * call it after mount, not during render.
 */
export function nfcWriteSupported(): boolean {
  return readerCtor() !== null && window.isSecureContext;
}

export type NfcWriteError = "unsupported" | "denied" | "cancelled" | "failed";

/**
 * Wait for a tag to come near the phone, then write `url` onto it as a single
 * URL record (replacing whatever the tag held).
 *
 * Resolves once written. The returned promise stays pending until a tag is
 * tapped, so pass a `signal` and abort it when the merchant gives up — an
 * unaborted write keeps the NFC radio waiting in the background.
 */
export async function writeUrlToTag(
  url: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: NfcWriteError }> {
  const Ctor = readerCtor();
  if (!Ctor || !window.isSecureContext) return { ok: false, error: "unsupported" };

  try {
    await new Ctor().write(
      { records: [{ recordType: "url", data: url }] },
      { signal, overwrite: true },
    );
    return { ok: true };
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "AbortError") return { ok: false, error: "cancelled" };
    // NotAllowedError: the merchant refused the NFC permission prompt, or NFC
    // is switched off in Android's settings.
    if (name === "NotAllowedError") return { ok: false, error: "denied" };
    // NetworkError / NotSupportedError: the tag moved away mid-write, is
    // locked read-only, or is too small for the URL.
    return { ok: false, error: "failed" };
  }
}
