CREATE TABLE "health_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"data_type" text NOT NULL,
	"operation" text NOT NULL,
	"range_start" timestamp NOT NULL,
	"range_end" timestamp NOT NULL,
	"record_id" text DEFAULT '' NOT NULL,
	"received_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp,
	"claimed_at" timestamp,
	"processed_at" timestamp,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "health_webhook_events" ADD CONSTRAINT "health_webhook_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_health_webhook_events_unique" ON "health_webhook_events" USING btree ("user_id","data_type","operation","range_start","range_end","record_id");--> statement-breakpoint
CREATE INDEX "idx_health_webhook_events_queue" ON "health_webhook_events" USING btree ("status","received_at");