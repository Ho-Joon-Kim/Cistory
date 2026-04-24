import { useEffect, useState } from "react";

/**
 * Returns `value` but delayed by `delayMs` whenever it changes. Useful for
 * debouncing derived fetches (e.g. refetching subway overlay after map pan).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
