import { pgTable, text, integer, boolean, timestamp, uniqueIndex, index, uuid, doublePrecision } from "drizzle-orm/pg-core";

// Note: Better Auth tables removed - Supabase manages auth.users and auth.sessions

// ============ App Users (Extended) ============
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(), // References Supabase auth.users.id
    githubId: integer("github_id").notNull().unique(),
    githubLogin: text("github_login").notNull(),
    githubAvatarUrl: text("github_avatar_url"),
    githubAccessToken: text("github_access_token").notNull(),
    ownTracksApiKey: text("own_tracks_api_key"),
    theme: text("theme").default("system"), // 'light' | 'dark' | 'system'
    syncIntervalHours: integer("sync_interval_hours").default(1),
    lastSyncedAt: timestamp("last_synced_at"),
    initialSyncCompleted: boolean("initial_sync_completed").default(false),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("idx_user_github_id").on(table.githubId),
  ]
);

// ============ Commits ============
export const commits = pgTable(
  "commits",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(), // 40-char hex
    message: text("message").notNull(),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email"),
    authorAvatarUrl: text("author_avatar_url"),
    committedAt: timestamp("committed_at").notNull(),
    additions: integer("additions").default(0),
    deletions: integer("deletions").default(0),
    changedFilesCount: integer("changed_files_count").default(0),
    isMergeCommit: boolean("is_merge_commit").default(false),
    parentShas: text("parent_shas"), // JSON array
    repoFullName: text("repo_full_name").notNull(), // 'owner/repo'
    repoId: integer("repo_id"), // GitHub repo ID (optional)
    repoIsPrivate: boolean("repo_is_private").default(false),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("idx_commit_user_id").on(table.userId),
    index("idx_commit_committed_at").on(table.committedAt),
    index("idx_commit_repo_full_name").on(table.repoFullName),
    uniqueIndex("idx_commit_user_sha").on(table.userId, table.sha),
  ]
);

// ============ Commit Summaries ============
export const commitSummaries = pgTable(
  "commit_summaries",
  {
    id: text("id").primaryKey(),
    commitId: text("commit_id")
      .notNull()
      .unique()
      .references(() => commits.id, { onDelete: "cascade" }),
    summary: text("summary"),
    status: text("status").default("pending"), // 'pending' | 'processing' | 'completed' | 'failed'
    retryCount: integer("retry_count").default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("idx_summary_commit_id").on(table.commitId),
    index("idx_summary_status").on(table.status),
  ]
);

// ============ Sync Jobs ============
export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    syncType: text("sync_type").notNull(), // 'events' | 'search' | 'initial'
    status: text("status").default("pending"), // 'pending' | 'fetching' | 'summarizing' | 'completed' | 'failed'
    triggerType: text("trigger_type").notNull(), // 'manual' | 'scheduled' | 'login'
    totalCommits: integer("total_commits").default(0),
    processedCommits: integer("processed_commits").default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("idx_sync_user_id").on(table.userId),
    index("idx_sync_status").on(table.status),
    index("idx_sync_created_at").on(table.createdAt),
  ]
);

// ============ Location Points (OwnTracks) ============
export const locationPoints = pgTable(
  "location_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    accuracy: integer("accuracy"),
    altitude: integer("altitude"),
    velocity: integer("velocity"),
    battery: integer("battery"),
    trackerId: text("tracker_id"),
    trigger: text("trigger"),
    timestamp: timestamp("timestamp").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("idx_location_user_timestamp").on(table.userId, table.timestamp),
    uniqueIndex("idx_location_unique").on(table.userId, table.timestamp, table.lat, table.lon),
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

export type LocationPoint = typeof locationPoints.$inferSelect;
export type NewLocationPoint = typeof locationPoints.$inferInsert;
