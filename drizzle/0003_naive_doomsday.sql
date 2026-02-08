CREATE TABLE "daily_distances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"distance_meters" double precision NOT NULL,
	"calculated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_distances" ADD CONSTRAINT "daily_distances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_daily_distance_user_date" ON "daily_distances" USING btree ("user_id","date");