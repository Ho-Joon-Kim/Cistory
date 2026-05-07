import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withAuth } from "@/lib/api-handler";
import { createPortfolioSyncService } from "@/modules/portfolio/service";

export const POST = withAuth(async ({ user }) => {
  const db = getDb();
  const sync = createPortfolioSyncService(db);
  const results = await sync.syncUserAccounts(user.id);
  return NextResponse.json({ results });
});
