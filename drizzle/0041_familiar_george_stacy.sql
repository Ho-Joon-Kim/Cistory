CREATE TABLE "segment_route_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"match_status" text NOT NULL,
	"shape" jsonb,
	"road_names" jsonb,
	"road_classes" jsonb,
	"confidence" double precision,
	"costing" text,
	"tile_version" text NOT NULL,
	"matched_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "segment_route_matches" ADD CONSTRAINT "segment_route_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_route_matches" ADD CONSTRAINT "segment_route_matches_segment_id_transportation_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."transportation_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_srm_segment" ON "segment_route_matches" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "idx_srm_user_status" ON "segment_route_matches" USING btree ("user_id","match_status");