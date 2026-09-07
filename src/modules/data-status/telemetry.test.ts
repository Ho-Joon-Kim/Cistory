import { expect, it, vi } from "vitest";
import type { Database } from "@/db";
import { logger } from "@/lib/logger";
import { recordSourceSuccess } from "./telemetry";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
it("keeps successful ingestion successful when telemetry storage fails without logging private payloads", async () => {
  const db = {
    insert: () => ({
      values: () => ({ onConflictDoUpdate: () => Promise.reject(new Error("private secret")) }),
    }),
  } as unknown as Database;
  await expect(
    recordSourceSuccess(db, "private-user", "toss", new Date())
  ).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalledWith(
    "[Data status] push success telemetry could not be saved",
    { source: "toss" }
  );
});
