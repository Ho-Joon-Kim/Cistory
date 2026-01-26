import { createAuth } from "@/lib/auth";
import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

async function handler(request: Request) {
  const { env } = getRequestContext();

  const auth = createAuth({
    DB: env.DB,
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
  });

  return auth.handler(request);
}

export const GET = handler;
export const POST = handler;
