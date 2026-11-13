import { eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { mcpAuditLog, users } from "@/db/schema";

/** Delete application data and every Better Auth credential in one transaction. */
export async function deleteAccount(db: Database, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Better Auth owns these tables outside the Drizzle application schema.
    // Delete dependents explicitly rather than relying on adapter FK defaults.
    await tx.execute(sql`DELETE FROM "session" WHERE "userId" = ${userId}`);
    await tx.execute(sql`DELETE FROM "account" WHERE "userId" = ${userId}`);
    await tx.delete(users).where(eq(users.id, userId));
    // Unrecognized-token MCP denials are stored with user_id NULL (they can't be
    // attributed), and the owner sees them alongside their own rows — so they
    // are this account's data too. The users cascade above can't reach them.
    await tx.delete(mcpAuditLog).where(isNull(mcpAuditLog.userId));
    await tx.execute(sql`DELETE FROM "user" WHERE "id" = ${userId}`);
  });
}
