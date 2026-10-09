"use client";

import { useEffect } from "react";

/**
 * The last resort: the root layout itself failed, so there is no stylesheet, font or
 * nav to lean on. It replaces the whole document, hence its own <html> and plain
 * inline styles.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[tender] app failed", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#ffffff", color: "#121111", fontFamily: "system-ui, sans-serif", padding: 24 }}>
        <div role="alert" style={{ textAlign: "center", maxWidth: 420 }}>
          <h1 style={{ fontSize: 28, fontWeight: 500, margin: "0 0 12px" }}>Something went wrong</h1>
          <p style={{ lineHeight: 1.6, opacity: 0.7, margin: "0 0 28px" }}>
            Tender didn&rsquo;t load. Anything you already sent is safe. Try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ border: 0, borderRadius: 999, padding: "10px 20px", background: "#121111", color: "#ffffff", fontSize: 14, cursor: "pointer" }}
          >
            Try again
          </button>
          {error.digest && <p style={{ marginTop: 24, fontSize: 11, opacity: 0.5, fontFamily: "monospace" }}>Reference: {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
