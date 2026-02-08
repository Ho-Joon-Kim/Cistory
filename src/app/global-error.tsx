"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h2>문제가 발생했습니다</h2>
          <button type="button" onClick={reset} style={{ marginTop: "1rem" }}>
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
