CREATE TABLE "location_processing_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"status" text NOT NULL,
	"processing_started_at" timestamp,
	"completed_at" timestamp,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "location_processing_days" ADD CONSTRAINT "location_processing_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_location_processing_day_user_date" ON "location_processing_days" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "idx_location_processing_day_status_started" ON "location_processing_days" USING btree ("status","processing_started_at");