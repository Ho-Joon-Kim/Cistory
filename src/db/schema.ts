import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ============ App Users (Extended) ============
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(), // References Better Auth user.id
    githubId: integer("github_id").notNull().unique(),
    githubLogin: text("github_login").notNull(),
    githubAvatarUrl: text("github_avatar_url"),
    ownTracksApiKey: text("own_tracks_api_key"),
    tossNotificationApiKey: text("toss_notification_api_key"),
    tossMyName: text("toss_my_name"),
    wakatimeApiKey: text("wakatime_api_key"),
    wakatimeLastSyncedAt: timestamp("wakatime_last_synced_at"),
    lastLat: doublePrecision("last_lat"),
    lastLon: doublePrecision("last_lon"),
    theme: text("theme").default("system"), // 'light' | 'dark' | 'system'
    syncIntervalHours: integer("sync_interval_hours").default(1),
    lastSyncedAt: timestamp("last_synced_at"),
    initialSyncCompleted: boolean("initial_sync_completed").default(false),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [index("idx_user_github_id").on(table.githubId)]
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
    status: text("status").default("fetching"), // 'fetching' | 'summarizing' | 'completed' | 'failed'
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
    index("idx_sync_user_status_created").on(table.userId, table.status, table.createdAt),
    index("idx_sync_user_status_completed").on(table.userId, table.status, table.completedAt),
  ]
);

// ============ Location Points (OwnTracks) ============
// Note: `lonlat` geography(Point, 4326) column is managed via PostGIS migration + trigger (not in Drizzle schema)
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
    anomaly: boolean("anomaly"),
    city: text("city"),
    countryName: text("country_name"),
    timestamp: timestamp("timestamp").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("idx_location_user_timestamp").on(table.userId, table.timestamp),
    uniqueIndex("idx_location_unique").on(table.userId, table.timestamp, table.lat, table.lon),
  ]
);

// ============ Place Cache (Geocoding) ============
export const placeCache = pgTable(
  "place_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    latKey: doublePrecision("lat_key").notNull(),
    lonKey: doublePrecision("lon_key").notNull(),
    placeName: text("place_name").notNull(),
    address: text("address").notNull(),
    category: text("category"),
    provider: text("provider").notNull(), // 'kakao' | 'mapbox'
    resolvedAt: timestamp("resolved_at").notNull(),
  },
  (table) => [uniqueIndex("idx_place_cache_lat_lon").on(table.latKey, table.lonKey)]
);

// ============ Daily Distances (Cache) ============
export const dailyDistances = pgTable(
  "daily_distances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // "YYYY-MM-DD"
    distanceMeters: doublePrecision("distance_meters").notNull(),
    calculatedAt: timestamp("calculated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_daily_distance_user_date").on(table.userId, table.date)]
);

// ============ Coding Sessions (WakaTime) ============
export const codingSessions = pgTable(
  "coding_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    project: text("project"),
    startedAt: timestamp("started_at").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    humanAdditions: integer("human_additions"),
    humanDeletions: integer("human_deletions"),
    aiAdditions: integer("ai_additions"),
    aiDeletions: integer("ai_deletions"),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("idx_coding_session_user_started").on(table.userId, table.startedAt),
    uniqueIndex("idx_coding_session_unique").on(table.userId, table.startedAt, table.project),
  ]
);

// ============ Coding Daily Stats (WakaTime) ============
export const codingDailyStats = pgTable(
  "coding_daily_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    totalSeconds: integer("total_seconds").notNull().default(0),
    projects: text("projects"), // JSON [{name, totalSeconds}]
    languages: text("languages"), // JSON [{name, totalSeconds}]
    editors: text("editors"), // JSON [{name, totalSeconds}]
    categories: text("categories"), // JSON [{name, totalSeconds}]
    calculatedAt: timestamp("calculated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_coding_daily_stats_user_date").on(table.userId, table.date)]
);

// ============ Saved Places ============
export const savedPlaces = pgTable(
  "saved_places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    radiusM: integer("radius_m").notNull().default(100),
    category: text("category"),
    address: text("address"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [index("idx_saved_place_user").on(table.userId)]
);

// ============ Visits (Detected Stay Points) ============
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    centerLat: doublePrecision("center_lat").notNull(),
    centerLon: doublePrecision("center_lon").notNull(),
    radiusM: doublePrecision("radius_m").notNull(),
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    placeName: text("place_name"),
    address: text("address"),
    category: text("category"),
    city: text("city"),
    countryName: text("country_name"),
    savedPlaceId: uuid("saved_place_id").references(() => savedPlaces.id, { onDelete: "set null" }),
    calculatedAt: timestamp("calculated_at").notNull(),
  },
  (table) => [
    index("idx_visit_user_start").on(table.userId, table.startTime),
    index("idx_visit_user_city").on(table.userId, table.city),
  ]
);

// ============ Tracks (Movement Journeys) ============
export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time").notNull(),
    distanceMeters: doublePrecision("distance_meters").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    pointCount: integer("point_count").notNull(),
    startPlaceName: text("start_place_name"),
    endPlaceName: text("end_place_name"),
    dominantMode: text("dominant_mode"), // walking/driving/train etc
    elevationGain: doublePrecision("elevation_gain"), // meters
    elevationLoss: doublePrecision("elevation_loss"), // meters
    calculatedAt: timestamp("calculated_at").notNull(),
  },
  (table) => [index("idx_track_user_start").on(table.userId, table.startTime)]
);

// ============ Transportation Segments ============
export const transportationSegments = pgTable(
  "transportation_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: uuid("track_id").references(() => tracks.id, { onDelete: "set null" }),
    date: text("date").notNull(), // "YYYY-MM-DD"
    mode: text("mode").notNull(), // stationary/walking/running/cycling/driving/train/flying/unknown
    confidence: text("confidence").notNull(), // high/medium/low
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time").notNull(),
    distanceMeters: doublePrecision("distance_meters").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    avgSpeedKmh: doublePrecision("avg_speed_kmh"),
    maxSpeedKmh: doublePrecision("max_speed_kmh"),
    avgAcceleration: doublePrecision("avg_acceleration"),
    calculatedAt: timestamp("calculated_at").notNull(),
  },
  (table) => [
    index("idx_transport_user_date").on(table.userId, table.date),
    index("idx_transport_user_start").on(table.userId, table.startTime),
    index("idx_transport_track").on(table.trackId),
  ]
);

// ============ Trips (Travel Detection) ============
export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: text("start_date").notNull(), // "YYYY-MM-DD"
    endDate: text("end_date").notNull(), // "YYYY-MM-DD"
    totalDistanceMeters: doublePrecision("total_distance_meters"),
    visitedCities: text("visited_cities"), // JSON array
    visitedCountries: text("visited_countries"), // JSON array
    isOverseas: boolean("is_overseas").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [index("idx_trip_user_start").on(table.userId, table.startDate)]
);

// ============ Notification Logs (Toss / MacroDroid) ============
export const notificationLogs = pgTable(
  "notification_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("toss"), // 'toss' | future sources
    rawPayload: text("raw_payload").notNull(), // JSON stringified raw body
    headers: text("headers"), // JSON stringified selected headers
    receivedAt: timestamp("received_at").notNull(),
  },
  (table) => [
    index("idx_notification_log_user_received").on(table.userId, table.receivedAt),
    index("idx_notification_log_source").on(table.source),
  ]
);

// ============ Transactions (Toss Parsed) ============
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notificationLogId: uuid("notification_log_id")
      .notNull()
      .references(() => notificationLogs.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'withdrawal' | 'deposit'
    amount: integer("amount").notNull(), // 원 단위
    merchant: text("merchant").notNull(), // 가맹점/출처명
    accountName: text("account_name").notNull(), // 계좌명
    isSelfTransfer: boolean("is_self_transfer").notNull().default(false),
    rawTitle: text("raw_title").notNull(),
    rawText: text("raw_text").notNull(),
    transactedAt: timestamp("transacted_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("idx_transaction_user_transacted").on(table.userId, table.transactedAt),
    uniqueIndex("idx_transaction_user_log").on(table.userId, table.notificationLogId),
  ]
);

// ============ Data Usage Cache ============
export const dataUsageCache = pgTable(
  "data_usage_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // 'commits' | 'location' | 'coding' | 'spending' | 'system'
    tableName: text("table_name").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    estimatedBytes: integer("estimated_bytes").notNull().default(0),
    calculatedAt: timestamp("calculated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_data_usage_user_table").on(table.userId, table.tableName),
    index("idx_data_usage_user").on(table.userId),
  ]
);

// ============ Fog of War Cells Cache ============
// Pre-aggregated 0.01°-grid cells per user. Refreshed by the daily location
// cron instead of GROUP BY-ing the full locationPoints table on every request.
export const fogCellsCache = pgTable(
  "fog_cells_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lat: doublePrecision("lat").notNull(),
    lon: doublePrecision("lon").notNull(),
    calculatedAt: timestamp("calculated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_fog_cells_unique").on(table.userId, table.lat, table.lon),
    index("idx_fog_cells_user").on(table.userId),
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

export type PlaceCache = typeof placeCache.$inferSelect;
export type NewPlaceCache = typeof placeCache.$inferInsert;

export type DailyDistance = typeof dailyDistances.$inferSelect;
export type NewDailyDistance = typeof dailyDistances.$inferInsert;

export type CodingSession = typeof codingSessions.$inferSelect;
export type NewCodingSession = typeof codingSessions.$inferInsert;

export type CodingDailyStat = typeof codingDailyStats.$inferSelect;
export type NewCodingDailyStat = typeof codingDailyStats.$inferInsert;

export type SavedPlace = typeof savedPlaces.$inferSelect;
export type NewSavedPlace = typeof savedPlaces.$inferInsert;

export type NotificationLog = typeof notificationLogs.$inferSelect;
export type NewNotificationLog = typeof notificationLogs.$inferInsert;

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export type DataUsageCache = typeof dataUsageCache.$inferSelect;
export type NewDataUsageCache = typeof dataUsageCache.$inferInsert;

export type Visit = typeof visits.$inferSelect;
export type NewVisit = typeof visits.$inferInsert;

export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;

export type TransportationSegment = typeof transportationSegments.$inferSelect;
export type NewTransportationSegment = typeof transportationSegments.$inferInsert;

export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;
