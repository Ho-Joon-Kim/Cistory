/**
 * GET  /api/settings/mcp-tokens — the owner's MCP tokens (prefix only, never the secret).
 * POST /api/settings/mcp-tokens — issue a token. The raw token is in this
 *      response only; it is never stored or shown again.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { issueToken, listTokens } from "@/modules/mcp/tokens";
import { mcpSettingsRoute } from "./shared";

export const GET = mcpSettingsRoute(
  async ({ user }) => NextResponse.json({ tokens: await listTokens(getDb(), user.id) }),
  { errorMessage: "MCP 토큰 목록을 불러오지 못했습니다." }
);

// Shape only; tokens.ts validates the values and answers with Korean 400s.
const IssueBody = z.object({
  name: z.string(),
  scopes: z.array(z.string()).max(8),
  allowedCidrs: z.array(z.string()).max(64).optional(),
  allowedCountries: z.array(z.string()).max(64).optional(),
  /** ISO instant, or null/absent for no expiry. */
  expiresAt: z.string().max(64).nullable().optional(),
});

export const POST = mcpSettingsRoute(
  async ({ user, request }) => {
    const raw = await request.json().catch(() => ({}));
    const body = IssueBody.parse(raw);
    const issued = await issueToken(getDb(), user.id, {
      name: body.name,
      scopes: body.scopes,
      allowedCidrs: body.allowedCidrs,
      allowedCountries: body.allowedCountries,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    });
    return NextResponse.json(issued, { status: 201 });
  },
  { mutation: true, errorMessage: "MCP 토큰을 만들지 못했습니다." }
);
