CREATE TABLE "subway_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL,
	"osm_relation_id" bigint NOT NULL,
	"name" text,
	"name_en" text,
	"ref" text,
	"colour" text,
	"operator" text,
	"network" text
);
--> statement-breakpoint
CREATE TABLE "subway_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL,
	"osm_node_id" bigint NOT NULL,
	"name" text,
	"name_en" text,
	"line_refs" jsonb
);
--> statement-breakpoint
CREATE TABLE "subway_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_key" text NOT NULL,
	"city_name" text NOT NULL,
	"country_code" text NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"last_refreshed_at" timestamp,
	"line_count" integer DEFAULT 0 NOT NULL,
	"station_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subway_systems_city_key_unique" UNIQUE("city_key")
);
--> statement-breakpoint
CREATE TABLE "subway_trip_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"transportation_segment_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"session_id" uuid,
	"leg_order" integer DEFAULT 0 NOT NULL,
	"sub_start_time" timestamp NOT NULL,
	"sub_end_time" timestamp NOT NULL,
	"start_station_id" uuid,
	"end_station_id" uuid,
	"coverage_ratio" double precision NOT NULL,
	"speed_profile_score" double precision NOT NULL,
	"gap_score" double precision NOT NULL,
	"station_score" double precision NOT NULL,
	"total_confidence" double precision NOT NULL,
	"matched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subway_lines" ADD CONSTRAINT "subway_lines_system_id_subway_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."subway_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subway_stations" ADD CONSTRAINT "subway_stations_system_id_subway_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."subway_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subway_trip_matches" ADD CONSTRAINT "subway_trip_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subway_trip_matches" ADD CONSTRAINT "subway_trip_matches_transportation_segment_id_transportation_segments_id_fk" FOREIGN KEY ("transportation_segment_id") REFERENCES "public"."transportation_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subway_trip_matches" ADD CONSTRAINT "subway_trip_matches_line_id_subway_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."subway_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subway_trip_matches" ADD CONSTRAINT "subway_trip_matches_start_station_id_subway_stations_id_fk" FOREIGN KEY ("start_station_id") REFERENCES "public"."subway_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subway_trip_matches" ADD CONSTRAINT "subway_trip_matches_end_station_id_subway_stations_id_fk" FOREIGN KEY ("end_station_id") REFERENCES "public"."subway_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subway_lines_system_relation" ON "subway_lines" USING btree ("system_id","osm_relation_id");--> statement-breakpoint
CREATE INDEX "idx_subway_lines_system" ON "subway_lines" USING btree ("system_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subway_stations_system_node" ON "subway_stations" USING btree ("system_id","osm_node_id");--> statement-breakpoint
CREATE INDEX "idx_subway_stations_system" ON "subway_stations" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "idx_subway_systems_city_key" ON "subway_systems" USING btree ("city_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_stm_segment_leg" ON "subway_trip_matches" USING btree ("transportation_segment_id","leg_order");--> statement-breakpoint
CREATE INDEX "idx_stm_user" ON "subway_trip_matches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_stm_line" ON "subway_trip_matches" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "idx_stm_session" ON "subway_trip_matches" USING btree ("session_id");--> statement-breakpoint

-- PostGIS geometry columns (managed outside Drizzle schema — same pattern as location_points.lonlat in 0013)
-- Requires postgis extension from migration 0013.
ALTER TABLE "subway_systems" ADD COLUMN IF NOT EXISTS "bbox" geometry(Polygon, 4326);--> statement-breakpoint
ALTER TABLE "subway_lines" ADD COLUMN IF NOT EXISTS "geometry" geometry(MultiLineString, 4326);--> statement-breakpoint
ALTER TABLE "subway_stations" ADD COLUMN IF NOT EXISTS "location" geometry(Point, 4326);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_subway_systems_bbox" ON "subway_systems" USING gist ("bbox");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subway_lines_geom" ON "subway_lines" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subway_stations_geom" ON "subway_stations" USING gist ("location");