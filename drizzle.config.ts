import { config } from "dotenv";
import type { Config } from "drizzle-kit";

// Load .env.local for drizzle-kit commands
config({ path: ".env.local" });

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://cistory:cistory@localhost:5432/cistory",
  },
} satisfies Config;
