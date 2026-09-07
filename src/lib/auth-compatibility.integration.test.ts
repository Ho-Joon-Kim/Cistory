import { randomUUID } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { getMigrations } from "better-auth/db/migration";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { deleteAccount } from "./account-deletion";

const injected = vi.hoisted(() => ({ pool: null as Pool | null, db: null as Database | null }));
vi.mock("@/db", async () => ({
  ...(await import("@/db/schema")),
  getPool: () => injected.pool,
  getDb: () => injected.db,
}));

// Private, explicitly legacy core tables: no issuer column or 1.7 generator.
// The only mocked seam is the application's database singleton.
describe("installed Better Auth against the 1.6 PostgreSQL schema", () => {
  const namespace = `auth_compat_${randomUUID().replaceAll("-", "")}`;
  const secret = "disposable-integration-auth-secret-32-characters";
  let admin: Pool;
  let pool: Pool;
  let auth: typeof import("./auth").auth;
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("Disposable TEST_DATABASE_URL required");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_SECRET", secret);
    vi.stubEnv("GITHUB_CLIENT_ID", "fixture-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "fixture-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("External network is forbidden in auth compatibility test");
      })
    );
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA "${namespace}"`);
    pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${namespace},public`,
    });
    injected.pool = pool;
    injected.db = drizzle(pool, { schema });
    await pool.query(`
      CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL,
        "emailVerified" boolean NOT NULL DEFAULT false, image text,
        "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);
      CREATE TABLE "session" (id text PRIMARY KEY, token text UNIQUE NOT NULL,
        "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL,
        "updatedAt" timestamptz NOT NULL, "ipAddress" text, "userAgent" text);
      CREATE TABLE "account" (id text PRIMARY KEY, "accountId" text NOT NULL,
        "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        "accessToken" text, "refreshToken" text, "idToken" text,
        "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
        scope text, password text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);
      CREATE TABLE verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
        "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);
      CREATE TABLE users (LIKE public.users INCLUDING ALL);
    `);
    auth = (await import("./auth")).auth;
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      await admin.end();
    }
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("needs no new core columns or tables, including account.issuer", async () => {
    const plan = await getMigrations(auth.options);
    expect(plan.toBeCreated).toEqual([]);
    expect(plan.toBeAdded).toEqual([]);
    expect(plan.unsafeChanges).toEqual([]);
    const columns = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'account'",
      [namespace]
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain("issuer");
    // Optional performance indexes may be proposed; no migration is executed.
  });

  async function seedUser() {
    const id = randomUUID();
    await pool.query(
      'INSERT INTO "user" (id,name,email,"createdAt","updatedAt") VALUES ($1,$2,$3,now(),now())',
      [id, "Fixture", `${id}@example.test`]
    );
    await injected
      .db!.insert(schema.users)
      .values({
        id,
        githubId: Math.floor(Math.random() * 2_000_000_000),
        githubLogin: id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    return id;
  }
  async function device(userId: string) {
    const token = randomUUID();
    await pool.query(
      'INSERT INTO session (id,token,"userId","expiresAt","createdAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'7 days\',now(),now())',
      [randomUUID(), token, userId]
    );
    const ctx = await auth.$context;
    return new Headers({
      cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${await makeSignature(token, secret)}`)}`,
      origin: "http://localhost:3000",
    });
  }

  it("reads real signed cookies, signs one device out, and deletion revokes both remaining devices", async () => {
    const userId = await seedUser();
    const signedOut = await device(userId);
    const first = await device(userId);
    const second = await device(userId);
    for (const headers of [signedOut, first, second])
      expect((await auth.api.getSession({ headers }))?.user.id).toBe(userId);
    const result = await auth.api.signOut({ headers: signedOut, returnHeaders: true });
    expect(result.response.success).toBe(true);
    expect(result.headers.getSetCookie().some((cookie) => cookie.includes("Max-Age=0"))).toBe(true);
    expect(await auth.api.getSession({ headers: signedOut })).toBeNull();
    expect((await auth.api.getSession({ headers: first }))?.user.id).toBe(userId);
    expect((await auth.api.getSession({ headers: second }))?.user.id).toBe(userId);
    await pool.query(
      'INSERT INTO account (id,"userId","providerId","accountId","accessToken","createdAt","updatedAt") VALUES ($1,$2,\'github\',$3,\'fixture-token\',now(),now())',
      [randomUUID(), userId, randomUUID()]
    );
    await deleteAccount(injected.db!, userId);
    expect(await auth.api.getSession({ headers: first })).toBeNull();
    expect(await auth.api.getSession({ headers: second })).toBeNull();
    expect((await pool.query('SELECT id FROM account WHERE "userId"=$1', [userId])).rows).toEqual(
      []
    );
    // Matches the application's delete-then-signOut sequence, including stale cookies.
    expect((await auth.api.signOut({ headers: first, returnHeaders: true })).response.success).toBe(
      true
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects duplicate provider/account identities instead of selecting an arbitrary user", async () => {
    const accountId = randomUUID();
    for (const userId of [await seedUser(), await seedUser()]) {
      await pool.query(
        'INSERT INTO account (id,"userId","providerId","accountId","createdAt","updatedAt") VALUES ($1,$2,\'github\',$3,now(),now())',
        [randomUUID(), userId, accountId]
      );
    }
    const ctx = await auth.$context;
    await expect(
      ctx.internalAdapter.findAccountByKey({ providerId: "github", accountId })
    ).rejects.toThrow("Multiple accounts");
  });
});
