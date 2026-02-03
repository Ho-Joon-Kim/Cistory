CREATE TABLE "location_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"accuracy" integer,
	"altitude" integer,
	"velocity" integer,
	"battery" integer,
	"tracker_id" text,
	"trigger" text,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "own_tracks_api_key" text;--> statement-breakpoint
ALTER TABLE "location_points" ADD CONSTRAINT "location_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_location_user_timestamp" ON "location_points" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_location_unique" ON "location_points" USING btree ("user_id","timestamp","lat","lon");