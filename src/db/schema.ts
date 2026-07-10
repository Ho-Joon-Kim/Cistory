import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
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
    velocity: integer("velocity"), // km/h
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
    spendingOverride: text("spending_override"), // 'include' | 'exclude' | null
    overrideNote: text("override_note"),
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

// ============ Account Roles (Spending Classification) ============
export const accountRoles = pgTable(
  "account_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountName: text("account_name").notNull(),
    role: text("role").notNull(), // 'spending' | 'default' | 'ignore'
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_account_role_user_name").on(table.userId, table.accountName)]
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

// ============ Subway Systems (OSM) ============
// NOTE: `bbox geometry(Polygon, 4326)` column is managed via raw SQL in migration 0019
// (not in Drizzle schema) — same pattern as location_points.lonlat.
export const subwaySystems = pgTable(
  "subway_systems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cityKey: text("city_key").notNull().unique(),
    cityName: text("city_name").notNull(),
    countryCode: text("country_code").notNull(),
    source: text("source").notNull().default("seed"), // 'seed' | 'discovered'
    lastRefreshedAt: timestamp("last_refreshed_at"),
    lineCount: integer("line_count").notNull().default(0),
    stationCount: integer("station_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_subway_systems_city_key").on(table.cityKey)]
);

// ============ Subway Lines (OSM relations) ============
// NOTE: `geometry geometry(MultiLineString, 4326)` managed via raw SQL.
export const subwayLines = pgTable(
  "subway_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    systemId: uuid("system_id")
      .notNull()
      .references(() => subwaySystems.id, { onDelete: "cascade" }),
    osmRelationId: bigint("osm_relation_id", { mode: "number" }).notNull(),
    name: text("name"),
    nameEn: text("name_en"),
    ref: text("ref"),
    colour: text("colour"), // normalized "#RRGGBB" or null
    operator: text("operator"),
    network: text("network"),
  },
  (table) => [
    uniqueIndex("idx_subway_lines_system_relation").on(table.systemId, table.osmRelationId),
    index("idx_subway_lines_system").on(table.systemId),
  ]
);

// ============ Subway Stations (OSM nodes) ============
// NOTE: `location geometry(Point, 4326)` managed via raw SQL.
export const subwayStations = pgTable(
  "subway_stations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    systemId: uuid("system_id")
      .notNull()
      .references(() => subwaySystems.id, { onDelete: "cascade" }),
    osmNodeId: bigint("osm_node_id", { mode: "number" }).notNull(),
    name: text("name"),
    nameEn: text("name_en"),
    lineRefs: jsonb("line_refs"), // e.g. ["2","3"] — transfers have multiple
  },
  (table) => [
    uniqueIndex("idx_subway_stations_system_node").on(table.systemId, table.osmNodeId),
    index("idx_subway_stations_system").on(table.systemId),
  ]
);

// ============ Subway Trip Matches (Phase 2) ============
// Links user's transportation segments to subway lines, with transfer-aware session grouping.
export const subwayTripMatches = pgTable(
  "subway_trip_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transportationSegmentId: uuid("transportation_segment_id")
      .notNull()
      .references(() => transportationSegments.id, { onDelete: "cascade" }),
    lineId: uuid("line_id")
      .notNull()
      .references(() => subwayLines.id),
    sessionId: uuid("session_id"),
    legOrder: integer("leg_order").notNull().default(0),
    subStartTime: timestamp("sub_start_time").notNull(),
    subEndTime: timestamp("sub_end_time").notNull(),
    startStationId: uuid("start_station_id").references(() => subwayStations.id),
    endStationId: uuid("end_station_id").references(() => subwayStations.id),
    coverageRatio: doublePrecision("coverage_ratio").notNull(),
    speedProfileScore: doublePrecision("speed_profile_score").notNull(),
    gapScore: doublePrecision("gap_score").notNull(),
    stationScore: doublePrecision("station_score").notNull(),
    totalConfidence: doublePrecision("total_confidence").notNull(),
    matchedAt: timestamp("matched_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_stm_segment_leg").on(table.transportationSegmentId, table.legOrder),
    index("idx_stm_user").on(table.userId),
    index("idx_stm_line").on(table.lineId),
    index("idx_stm_session").on(table.sessionId),
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

export type SubwaySystem = typeof subwaySystems.$inferSelect;
export type NewSubwaySystem = typeof subwaySystems.$inferInsert;

export type SubwayLine = typeof subwayLines.$inferSelect;
export type NewSubwayLine = typeof subwayLines.$inferInsert;

export type SubwayStation = typeof subwayStations.$inferSelect;
export type NewSubwayStation = typeof subwayStations.$inferInsert;

export type SubwayTripMatch = typeof subwayTripMatches.$inferSelect;
export type NewSubwayTripMatch = typeof subwayTripMatches.$inferInsert;

// ============ Brokerage / Portfolio ============
export const brokerageAccounts = pgTable(
  "brokerage_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    broker: text("broker").notNull().default("kis"),
    cano: text("cano").notNull(),
    acntPrdtCd: text("acnt_prdt_cd").notNull(),
    accountType: text("account_type").notNull(),
    appKeyEnc: text("app_key_enc").notNull(),
    appSecretEnc: text("app_secret_enc").notNull(),
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    isActive: boolean("is_active").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at"),
    lastSyncError: text("last_sync_error"),
    // Account open date (YYYY-MM-DD). When set, the backfill job walks
    // from `openedAt` forward to today filling any gap in executions /
    // daily-pnl that hasn't been pulled yet.
    openedAt: text("opened_at"),
    // Earliest date we've already pulled executions for. Used as the
    // backfill watermark so we only fetch the un-pulled prefix.
    // Null = backfill never run.
    executionsBackfilledFrom: text("executions_backfilled_from"),
    pnlBackfilledFrom: text("pnl_backfilled_from"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_brokerage_user").on(t.userId),
    uniqueIndex("idx_brokerage_user_cano").on(t.userId, t.cano, t.acntPrdtCd),
  ]
);

export const holdingSnapshots = pgTable(
  "holding_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => brokerageAccounts.id, { onDelete: "cascade" }),
    takenAt: timestamp("taken_at").notNull(),
    asOfDate: text("as_of_date").notNull(),
    totalEvalAmount: numeric("total_eval_amount").notNull(),
    securitiesEvalAmount: numeric("securities_eval_amount").notNull(),
    deposit: numeric("deposit").notNull(),
    totalPurchaseAmount: numeric("total_purchase_amount").notNull(),
    totalPnl: numeric("total_pnl").notNull(),
    totalPnlRate: numeric("total_pnl_rate"),
    realizedPnl: numeric("realized_pnl"),
    prevDayTotalAsset: numeric("prev_day_total_asset"),
    assetIcdcAmt: numeric("asset_icdc_amt"),
    rawOutput2: text("raw_output2").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_snapshot_account_date").on(t.accountId, t.asOfDate),
    uniqueIndex("idx_snapshot_unique").on(t.accountId, t.asOfDate),
  ]
);

export const holdingPositions = pgTable(
  "holding_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => holdingSnapshots.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    name: text("name").notNull(),
    quantity: numeric("quantity").notNull(),
    avgPrice: numeric("avg_price").notNull(),
    currentPrice: numeric("current_price").notNull(),
    evalAmount: numeric("eval_amount").notNull(),
    pnl: numeric("pnl").notNull(),
    pnlRate: numeric("pnl_rate"),
    weight: numeric("weight").notNull(),
    market: text("market"),
    rawData: text("raw_data").notNull(),
  },
  (t) => [
    index("idx_position_snapshot").on(t.snapshotId),
    index("idx_position_ticker").on(t.ticker, t.snapshotId),
  ]
);

export const brokerageExecutions = pgTable(
  "brokerage_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => brokerageAccounts.id, { onDelete: "cascade" }),
    odno: text("odno").notNull(),
    ordDt: text("ord_dt").notNull(),
    ordTime: text("ord_time"),
    side: text("side").notNull(),
    ticker: text("ticker").notNull(),
    name: text("name").notNull(),
    orderQty: numeric("order_qty").notNull(),
    filledQty: numeric("filled_qty").notNull(),
    filledAmount: numeric("filled_amount").notNull(),
    avgPrice: numeric("avg_price").notNull(),
    cancelled: boolean("cancelled").notNull().default(false),
    rawData: text("raw_data").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_exec_account_date").on(t.accountId, t.ordDt),
    uniqueIndex("idx_exec_unique").on(t.accountId, t.odno, t.ordDt),
  ]
);

export const brokerageDailyPnl = pgTable(
  "brokerage_daily_pnl",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => brokerageAccounts.id, { onDelete: "cascade" }),
    tradeDate: text("trade_date").notNull(),
    buyAmount: numeric("buy_amount").notNull(),
    sellAmount: numeric("sell_amount").notNull(),
    realizedPnl: numeric("realized_pnl").notNull(),
    fee: numeric("fee").notNull(),
    tax: numeric("tax").notNull(),
  },
  (t) => [uniqueIndex("idx_daily_pnl_unique").on(t.accountId, t.tradeDate)]
);

export const brokerageTargetAllocations = pgTable(
  "brokerage_target_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => brokerageAccounts.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    name: text("name").notNull(),
    targetWeight: numeric("target_weight").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_target_alloc_account").on(t.accountId),
    uniqueIndex("idx_target_alloc_unique").on(t.accountId, t.ticker),
  ]
);

export type BrokerageAccount = typeof brokerageAccounts.$inferSelect;
export type NewBrokerageAccount = typeof brokerageAccounts.$inferInsert;
export type HoldingSnapshot = typeof holdingSnapshots.$inferSelect;
export type NewHoldingSnapshot = typeof holdingSnapshots.$inferInsert;
export type HoldingPosition = typeof holdingPositions.$inferSelect;
export type NewHoldingPosition = typeof holdingPositions.$inferInsert;
export type BrokerageExecution = typeof brokerageExecutions.$inferSelect;
export type NewBrokerageExecution = typeof brokerageExecutions.$inferInsert;
export type BrokerageDailyPnl = typeof brokerageDailyPnl.$inferSelect;
export type NewBrokerageDailyPnl = typeof brokerageDailyPnl.$inferInsert;
export type BrokerageTargetAllocation = typeof brokerageTargetAllocations.$inferSelect;
export type NewBrokerageTargetAllocation = typeof brokerageTargetAllocations.$inferInsert;
