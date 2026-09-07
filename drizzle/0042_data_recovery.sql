CREATE TABLE "data_recovery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"from_date" text NOT NULL,
	"to_date" text NOT NULL,
	"next_date" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp,
	"error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "source_sync_states" (
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"last_attempt_at" timestamp NOT NULL,
	"last_success_at" timestamp,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "data_recovery_jobs" ADD CONSTRAINT "data_recovery_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sync_states" ADD CONSTRAINT "source_sync_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_data_recovery_user_source" ON "data_recovery_jobs" USING btree ("user_id","source");--> statement-breakpoint
CREATE INDEX "idx_data_recovery_queue" ON "data_recovery_jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_source_sync_user_source" ON "source_sync_states" USING btree ("user_id","source");