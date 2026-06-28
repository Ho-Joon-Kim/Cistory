import { afterEach, vi } from "vitest";

// Restore spies/mocks between tests so mock state never leaks across files.
afterEach(() => {
  vi.restoreAllMocks();
});
