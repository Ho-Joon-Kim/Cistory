import type { NextRequest } from "next/server";
import { handleMcpPost, methodNotAllowed } from "@/modules/mcp/http";

// MCP Streamable HTTP endpoint (stateless, JSON responses). The whole request
// pipeline — Origin, body cap, token, rate limit, lock, scope, SDK — lives in
// src/modules/mcp/http.ts; see the header there.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  return handleMcpPost(request);
}

// Stateless server: no SSE listen stream (GET) and no session to end (DELETE).
export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}
