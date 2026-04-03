CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"distance_meters" double precision NOT NULL,
	"duration_seconds" integer NOT NULL,
	"point_count" integer NOT NULL,
	"start_place_name" text,
	"end_place_name" text,
	"dominant_mode" text,
	"elevation_gain" double precision,
	"elevation_loss" double precision,
	"calculated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"total_distance_meters" double precision,
	"visited_cities" text,
	"visited_countries" text,
	"is_overseas" boolean DEFAULT false NOT NULL,
	"auto_detected" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transportation_segments" ADD COLUMN "track_id" uuid;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_track_user_start" ON "tracks" USING btree ("user_id","start_time");--> statement-breakpoint
CREATE INDEX "idx_trip_user_start" ON "trips" USING btree ("user_id","start_date");--> statement-breakpoint
ALTER TABLE "transportation_segments" ADD CONSTRAINT "transportation_segments_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_transport_track" ON "transportation_segments" USING btree ("track_id");