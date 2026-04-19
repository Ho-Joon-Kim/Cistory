import { useCallback } from "react";

/**
 * Client-side NDJSON stream reader.
 *
 * POSTs `body` to `url`, then reads the response body line by line,
 * invoking `onEvent(parsedJson)` for each non-empty line that parses.
 * Malformed lines are silently skipped (same behavior as the inline
 * reparse/cleanup readers that previously duplicated this logic).
 *
 * Does not manage loading state — callers wrap this with their own
 * `isLoading` flags since different consumers want different UX.
 */
export interface UseNdjsonStreamOptions {
  /** Abort signal to allow cancellation from the caller. */
  signal?: AbortSignal;
  /** Called once with `{ total? }` when the HTTP response is received OK. */
  onStart?: () => void;
}

export function useNdjsonStream() {
  return useCallback(
    async <TEvent = unknown>(
      url: string,
      body: unknown,
      onEvent: (event: TEvent) => void,
      options?: UseNdjsonStreamOptions
    ): Promise<void> => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`NDJSON stream request failed: ${response.status} ${response.statusText}`);
      }

      options?.onStart?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the final (possibly incomplete) chunk for the next read
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            onEvent(JSON.parse(line) as TEvent);
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Flush any remaining buffered content
      if (buffer.trim()) {
        try {
          onEvent(JSON.parse(buffer) as TEvent);
        } catch {
          // ignore
        }
      }
    },
    []
  );
}
