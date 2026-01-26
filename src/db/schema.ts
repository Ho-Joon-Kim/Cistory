import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// ============ Better Auth Tables ============
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ============ App Users (Extended) ============
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    githubId: integer("github_id").notNull().unique(),
    githubLogin: text("github_login").notNull(),
    githubAvatarUrl: text("github_avatar_url"),
    githubAccessToken: text("github_access_token").notNull(),
    theme: text("theme").default("system"), // 'light' | 'dark' | 'system'
    syncIntervalHours: integer("sync_interval_hours").default(1),
    lastSyncedAt: text("last_synced_at"), // ISO 8601
    initialSyncCompleted: integer("initial_sync_completed", { mode: "boolean" }).default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_user_github_id").on(table.githubId),
  ]
);

// ============ Commits ============
export const commits = sqliteTable(
  "commits",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(), // 40-char hex
    message: text("message").notNull(),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email"),
    authorAvatarUrl: text("author_avatar_url"),
    committedAt: text("committed_at").notNull(), // ISO 8601
    additions: integer("additions").default(0),
    deletions: integer("deletions").default(0),
    changedFilesCount: integer("changed_files_count").default(0),
    isMergeCommit: integer("is_merge_commit", { mode: "boolean" }).default(false),
    parentShas: text("parent_shas"), // JSON array
    repoFullName: text("repo_full_name").notNull(), // 'owner/repo'
    repoId: integer("repo_id"), // GitHub repo ID (optional)
    repoIsPrivate: integer("repo_is_private", { mode: "boolean" }).default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_commit_user_id").on(table.userId),
    index("idx_commit_committed_at").on(table.committedAt),
    index("idx_commit_repo_full_name").on(table.repoFullName),
    uniqueIndex("idx_commit_user_sha").on(table.userId, table.sha),
  ]
);

// ============ Commit Summaries ============
export const commitSummaries = sqliteTable(
  "commit_summaries",
  {
    id: text("id").primaryKey(),
    commitId: text("commit_id")
      .notNull()
      .unique()
      .references(() => commits.id, { onDelete: "cascade" }),
    technicalSummary: text("technical_summary"),
    nonTechnicalSummary: text("non_technical_summary"),
    status: text("status").default("pending"), // 'pending' | 'processing' | 'completed' | 'failed'
    retryCount: integer("retry_count").default(0),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_summary_commit_id").on(table.commitId),
    index("idx_summary_status").on(table.status),
  ]
);

// ============ Sync Jobs ============
export const syncJobs = sqliteTable(
  "sync_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    syncType: text("sync_type").notNull(), // 'events' | 'search' | 'initial'
    status: text("status").default("pending"), // 'pending' | 'fetching' | 'summarizing' | 'completed' | 'failed'
    triggerType: text("trigger_type").notNull(), // 'manual' | 'scheduled' | 'login'
    totalCommits: integer("total_commits").default(0),
    processedCommits: integer("processed_commits").default(0),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_sync_user_id").on(table.userId),
    index("idx_sync_status").on(table.status),
    index("idx_sync_created_at").on(table.createdAt),
  ]
);

// ============ Type Exports ============
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Commit = typeof commits.$inferSelect;
export type NewCommit = typeof commits.$inferInsert;

export type CommitSummary = typeof commitSummaries.$inferSelect;
export type NewCommitSummary = typeof commitSummaries.$inferInsert;

export type SyncJob = typeof syncJobs.$inferSelect;
export type NewSyncJob = typeof syncJobs.$inferInsert;
