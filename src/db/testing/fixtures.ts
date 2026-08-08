import { randomInt, randomUUID } from "node:crypto";
import { users } from "@/db";
import type { TestDb } from "./transactional-db";

/**
 * Minimal valid `users` row for integration fixtures. `users` has no DB
 * defaults for `createdAt`/`updatedAt` (unlike most other tables), so every
 * insert needs them supplied explicitly.
 *
 * `githubId` is unique — random rather than sequential because tests in
 * different files hold concurrent, uncommitted transactions against the
 * same table and must never collide on it.
 */
export async function insertTestUser(
  db: TestDb,
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<string> {
  const id = overrides.id ?? randomUUID();
  const now = new Date();
  await db.insert(users).values({
    githubId: randomInt(1, 2_147_483_647),
    githubLogin: `integration-test-${id.slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
    ...overrides,
    id,
  });
  return id;
}
