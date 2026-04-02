CREATE TABLE "transportation_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"mode" text NOT NULL,
	"confidence" text NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"distance_meters" double precision NOT NULL,
	"duration_seconds" integer NOT NULL,
	"avg_speed_kmh" double precision,
	"max_speed_kmh" double precision,
	"avg_acceleration" double precision,
	"calculated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"center_lat" double precision NOT NULL,
	"center_lon" double precision NOT NULL,
	"radius_m" double precision NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"duration_seconds" integer NOT NULL,
	"place_name" text,
	"address" text,
	"category" text,
	"city" text,
	"country_name" text,
	"saved_place_id" uuid,
	"calculated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "location_points" ADD COLUMN "anomaly" boolean;--> statement-breakpoint
ALTER TABLE "location_points" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "location_points" ADD COLUMN "country_name" text;--> statement-breakpoint
ALTER TABLE "transportation_segments" ADD CONSTRAINT "transportation_segments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_saved_place_id_saved_places_id_fk" FOREIGN KEY ("saved_place_id") REFERENCES "public"."saved_places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_transport_user_date" ON "transportation_segments" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "idx_transport_user_start" ON "transportation_segments" USING btree ("user_id","start_time");--> statement-breakpoint
CREATE INDEX "idx_visit_user_start" ON "visits" USING btree ("user_id","start_time");--> statement-breakpoint
CREATE INDEX "idx_visit_user_city" ON "visits" USING btree ("user_id","city");