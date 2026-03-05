import { betterAuth } from "better-auth";
import { getPool, getDb, users } from "@/db";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL,
  database: getPool(),
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      scope: ["repo", "read:user"],
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 300,
    },
  },
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          // Sync GitHub data to app users table on every sign-in
          const db = getDb();
          const pool = getPool();
          try {
            const accountResult = await pool.query(
              `SELECT "accessToken", "providerId" FROM "account" WHERE "userId" = $1 AND "providerId" = 'github' LIMIT 1`,
              [session.userId],
            );
            const row = accountResult.rows?.[0];
            if (!row?.accessToken) return;

            const githubResponse = await fetch("https://api.github.com/user", {
              headers: {
                Authorization: `Bearer ${row.accessToken}`,
                Accept: "application/vnd.github.v3+json",
              },
            });

            if (!githubResponse.ok) return;

            const githubUser = (await githubResponse.json()) as {
              id: number;
              login: string;
              avatar_url: string;
            };

            const now = new Date();
            await db
              .insert(users)
              .values({
                id: session.userId,
                githubId: githubUser.id,
                githubLogin: githubUser.login,
                githubAvatarUrl: githubUser.avatar_url,
                githubAccessToken: row.accessToken,
                theme: "system",
                syncIntervalHours: 1,
                initialSyncCompleted: false,
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: users.id,
                set: {
                  githubAccessToken: row.accessToken,
                  githubAvatarUrl: githubUser.avatar_url,
                  githubLogin: githubUser.login,
                  updatedAt: now,
                },
              });
          } catch (error) {
            console.error("[Auth] Failed to sync user data on session create:", error);
          }
        },
      },
    },
  },
});
