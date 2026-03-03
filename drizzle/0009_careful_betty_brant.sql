CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_log_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"merchant" text NOT NULL,
	"account_name" text NOT NULL,
	"raw_title" text NOT NULL,
	"raw_text" text NOT NULL,
	"transacted_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_notification_log_id_notification_logs_id_fk" FOREIGN KEY ("notification_log_id") REFERENCES "public"."notification_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_transaction_user_transacted" ON "transactions" USING btree ("user_id","transacted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_transaction_user_log" ON "transactions" USING btree ("user_id","notification_log_id");