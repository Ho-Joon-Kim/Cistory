import { config } from "dotenv";
import type { Config } from "drizzle-kit";
import { resolveDrizzleDatabaseUrl } from "./src/lib/drizzle-env";

// drizzle-kit's CLI auto-imports `dotenv/config` before this file is evaluated, which
// already loads `.env` into process.env with dotenv's default override:false. Without
// `override: true` below, that `.env` value already occupies process.env.DATABASE_URL and
// this `.env.local` load becomes a silent no-op (drizzle-kit itself reports it as
// "injecting env (0) from .env.local") — override:true is what makes `.env.local` win,
// not a redundant flag.
//
// Precedence: DRIZZLE_DATABASE_URL > .env.local > .env > the localhost fallback below.
// DRIZZLE_DATABASE_URL is a deliberate escape hatch: override:true can't tell `.env`'s value
// apart from one you exported by hand (e.g. `DATABASE_URL=... yarn db:migrate`), so it would
// otherwise clobber an intentional shell override too. Set DRIZZLE_DATABASE_URL instead when
// you need that.
config({ path: ".env.local", override: true });

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveDrizzleDatabaseUrl({
      DRIZZLE_DATABASE_URL: process.env.DRIZZLE_DATABASE_URL,
      DATABASE_URL: process.env.DATABASE_URL,
    }),
  },
} satisfies Config;
