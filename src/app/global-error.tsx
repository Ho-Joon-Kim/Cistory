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
        <main id="main" style={{ padding: "2rem", textAlign: "center" }}>
          <h1>문제가 발생했습니다</h1>
          <p>앱을 불러오지 못했습니다. 다시 시도를 누르거나 잠시 후 다시 열어 주세요.</p>
          <button type="button" onClick={reset} style={{ marginTop: "1rem" }}>
            다시 시도
          </button>
        </main>
      </body>
    </html>
  );
}
