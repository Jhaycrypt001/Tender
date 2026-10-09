"use client";

import { useEffect } from "react";
import { reloadIfStale } from "@/lib/stale-deploy";

/**
 * Catches the out-of-date-tab errors no screen handled itself (a server action called from an
 * effect, a lazy chunk that is gone) and reloads onto the new deployment. See lib/stale-deploy.
 */
export function StaleDeployGuard() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (reloadIfStale(event.reason)) event.preventDefault();
    };
    const onError = (event: ErrorEvent) => {
      reloadIfStale(event.error ?? event.message);
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);
  return null;
}
