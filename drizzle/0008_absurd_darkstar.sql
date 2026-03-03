CREATE TABLE "notification_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'toss' NOT NULL,
	"raw_payload" text NOT NULL,
	"headers" text,
	"received_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "toss_notification_api_key" text;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notification_log_user_received" ON "notification_logs" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_notification_log_source" ON "notification_logs" USING btree ("source");