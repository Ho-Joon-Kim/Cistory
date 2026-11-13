/**
 * GET    /api/settings/mcp-tokens/audit — the owner's MCP audit log, newest
 *        first, filtered by token/tool/outcome and a KST day range, keyset
 *        paginated (`cursor` → `nextCursor`).
 * DELETE /api/settings/mcp-tokens/audit { from?, to?, tokenId? } — delete by
 *        KST day range and/or token. An empty filter is refused (400), so one
 *        request can't wipe the whole log by accident.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { ApiError } from "@/lib/api-handler";
import {
  AUDIT_PAGE_MAX,
  deleteAuditLog,
  listAuditLog,
  McpAuditCursorError,
  McpAuditDeleteScopeError,
} from "@/modules/mcp/audit";
import { kstRange, mcpSettingsRoute, UUID_PATTERN } from "../shared";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const ListQuery = z.object({
  tokenId: z.string().regex(UUID_PATTERN).optional(),
  tool: z.string().min(1).max(64).optional(),
  outcome: z.enum(["ok", "error", "denied"]).optional(),
  from: z.string().regex(DATE_KEY).optional(),
  to: z.string().regex(DATE_KEY).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).optional(),
});

export const GET = mcpSettingsRoute(
  async ({ user, request }) => {
    const params = Object.fromEntries(
      [...request.nextUrl.searchParams.entries()].filter(([, value]) => value !== "")
    );
    const query = ListQuery.parse(params);
    const range = kstRange(query.from, query.to);
    try {
      const page = await listAuditLog(getDb(), user.id, {
        tokenId: query.tokenId,
        tool: query.tool,
        outcome: query.outcome,
        ...range,
        cursor: query.cursor,
        limit: query.limit,
      });
      return NextResponse.json(page);
    } catch (error) {
      if (error instanceof McpAuditCursorError) {
        throw new ApiError(400, error.message, "INVALID_CURSOR");
      }
      throw error;
    }
  },
  { errorMessage: "감사 로그를 불러오지 못했습니다." }
);

const DeleteBody = z.object({
  tokenId: z.string().regex(UUID_PATTERN).optional(),
  from: z.string().regex(DATE_KEY).optional(),
  to: z.string().regex(DATE_KEY).optional(),
});

export const DELETE = mcpSettingsRoute(
  async ({ user, request }) => {
    const body = DeleteBody.parse(await request.json().catch(() => ({})));
    const range = kstRange(body.from, body.to);
    try {
      const deleted = await deleteAuditLog(getDb(), user.id, {
        tokenId: body.tokenId,
        ...range,
      });
      return NextResponse.json({ deleted });
    } catch (error) {
      if (error instanceof McpAuditDeleteScopeError) {
        throw new ApiError(400, error.message, "AUDIT_DELETE_SCOPE_REQUIRED");
      }
      throw error;
    }
  },
  { mutation: true, errorMessage: "감사 로그를 삭제하지 못했습니다." }
);
