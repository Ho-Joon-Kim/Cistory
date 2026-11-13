/**
 * Meta tools. `whoami` is also the reference example for a read tool:
 * declare the schema, scope, explicit annotations and audit arg rules, and
 * return allowlist-serialized `structured` output (+09:00 times via time.ts).
 */

import { z } from "zod";
import { defineTool, type McpTool } from "../server";
import { toKstIso } from "../time";

export const whoamiTool = defineTool({
  name: "whoami",
  kind: "read",
  scope: "read",
  title: "토큰 정보",
  description:
    "이 연결에 쓰인 토큰의 이름과 스코프, 서버의 현재 시각(+09:00)을 돌려줍니다. 시각 계산의 기준점으로 쓰세요.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: z.object({}),
  outputSchema: z.object({
    tokenName: z.string(),
    scopes: z.array(z.string()),
    serverTime: z.string(),
    timezone: z.literal("Asia/Seoul"),
  }),
  argRules: {},
  run: async (ctx) => ({
    structured: {
      tokenName: ctx.tokenName,
      scopes: [...ctx.scopes],
      serverTime: toKstIso(ctx.now),
      timezone: "Asia/Seoul",
    },
    count: null,
  }),
});

export const META_TOOLS: McpTool[] = [whoamiTool];
