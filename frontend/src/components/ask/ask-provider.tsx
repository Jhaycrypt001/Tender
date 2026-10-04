"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Opens the Ask assistant over the current dashboard screen, without a route
 * change. Wraps the `(dash)` layout so the nav button, the mobile sheet and the
 * home page's Ask action all open the same overlay through `useAsk()`.
 *
 * While the overlay is up, everything behind it is `inert`: no focus, no
 * clicks, nothing announced. Closing fades out, then hands focus back to
 * whatever opened it. `/app/ask` still exists as a plain page for deep links.
 */

const AskOverlay = dynamic(() => import("./ask-overlay"), { ssr: false });
// Fetch the overlay chunk once the browser is idle, so the first tap animates
// immediately instead of waiting on the network.
const preload = () => void import("./ask-overlay");

type AskApi = { open: () => void; isOpen: boolean };
const AskContext = createContext<AskApi>({ open: () => {}, isOpen: false });

export function useAsk(): AskApi {
  return useContext(AskContext);
}

/** Matches the fade-out in ask.css (`.ask-root[data-closing]`). */
const CLOSE_MS = 200;

export function AskProvider({
  firstName,
  children,
}: {
  firstName: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<"closed" | "open" | "closing">("closed");
  const returnTo = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pathname = usePathname();

  const open = useCallback(() => {
    window.clearTimeout(timer.current);
    if (document.activeElement instanceof HTMLElement) returnTo.current = document.activeElement;
    setState("open");
  }, []);

  const close = useCallback(() => {
    setState((s) => (s === "open" ? "closing" : s));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("closed"), CLOSE_MS);
  }, []);

  // Focus goes back only after the commit that lifts `inert`; an inert
  // element silently refuses focus. The trigger may also have been inside a
  // sheet that is gone now.
  useEffect(() => {
    if (state !== "closed") return;
    const el = returnTo.current;
    returnTo.current = null;
    if (el?.isConnected) el.focus({ preventScroll: true });
  }, [state]);

  // The browser's back button, or any other navigation, takes it down.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    window.clearTimeout(timer.current);
    returnTo.current = null;
    setState("closed");
  }, [pathname]);

  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(preload);
    else window.setTimeout(preload, 1500);
    return () => window.clearTimeout(timer.current);
  }, []);

  const shown = state !== "closed";

  return (
    <AskContext.Provider value={{ open, isOpen: shown }}>
      <div className="contents" inert={shown}>
        {children}
      </div>
      {shown && <AskOverlay firstName={firstName} closing={state === "closing"} onClose={close} />}
    </AskContext.Provider>
  );
}
