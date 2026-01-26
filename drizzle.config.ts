import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: "4facf9ea-e66c-4833-8e7a-9e93048cf5ba",
    token: process.env.CLOUDFLARE_D1_TOKEN!,
  },
} satisfies Config;
