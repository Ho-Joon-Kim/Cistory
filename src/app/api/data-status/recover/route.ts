import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { withValidation } from "@/lib/api-handler";
import { enqueueRecovery } from "@/modules/data-status/recovery";
import { RECOVERABLE_SOURCES } from "@/modules/data-status/types";

const Body = z
  .object({ source: z.enum(RECOVERABLE_SOURCES), from: z.string(), to: z.string() })
  .strict();
export const POST = withValidation(Body, async ({ user, body }) => {
  const job = await enqueueRecovery(getDb(), user.id, body.source, body.from, body.to);
  return NextResponse.json({ job }, { status: 202 });
});
