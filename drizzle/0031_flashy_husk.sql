CREATE TABLE "location_heatmap_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"count" integer NOT NULL,
	"calculated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "location_heatmap_daily" ADD CONSTRAINT "location_heatmap_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_location_heatmap_daily_grid" ON "location_heatmap_daily" USING btree ("user_id","date","lat","lon");--> statement-breakpoint
CREATE INDEX "idx_location_heatmap_daily_user_date" ON "location_heatmap_daily" USING btree ("user_id","date");