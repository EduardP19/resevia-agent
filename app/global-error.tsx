"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void fetch("/api/log-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "app.global-error",
        message: error?.message || "Unknown client error",
        stack: error?.stack || null,
        context: { digest: error?.digest || null },
        path: typeof window !== "undefined" ? window.location.pathname : null,
      }),
    }).catch(() => {
      // Intentionally ignored: avoid loops in global error UI.
    });
  }, [error]);

  return (
    <html>
      <body style={{ fontFamily: "sans-serif", padding: 24 }}>
        <h2>Something went wrong</h2>
        <p>Please try again.</p>
        <button onClick={() => reset()}>Try again</button>
      </body>
    </html>
  );
}
