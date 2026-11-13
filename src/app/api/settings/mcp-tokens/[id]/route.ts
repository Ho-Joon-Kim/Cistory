/**
 * POST   /api/settings/mcp-tokens/:id { action: "rotate" } — new secret, same
 *        settings; the old token stops working. The raw token is in this
 *        response only.
 * DELETE /api/settings/mcp-tokens/:id — revoke (idempotent).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { McpTokenNotFoundError, revokeToken, rotateToken } from "@/modules/mcp/tokens";
import { mcpSettingsRoute, UUID_PATTERN } from "../shared";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function tokenId(params: RouteParams["params"]): Promise<string> {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) throw new McpTokenNotFoundError();
  return id;
}

const ActionBody = z.object({ action: z.literal("rotate") });

export const POST = mcpSettingsRoute<RouteParams>(
  async ({ user, request }, { params }) => {
    const id = await tokenId(params);
    ActionBody.parse(await request.json().catch(() => ({})));
    return NextResponse.json(await rotateToken(getDb(), user.id, id));
  },
  { mutation: true, errorMessage: "MCP 토큰을 다시 만들지 못했습니다." }
);

export const DELETE = mcpSettingsRoute<RouteParams>(
  async ({ user }, { params }) => {
    const id = await tokenId(params);
    if (!(await revokeToken(getDb(), user.id, id))) throw new McpTokenNotFoundError();
    return NextResponse.json({ revoked: true });
  },
  { mutation: true, errorMessage: "MCP 토큰을 폐기하지 못했습니다." }
);
