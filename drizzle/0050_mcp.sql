CREATE TABLE "mcp_alert_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_id" uuid,
	"token_key" text DEFAULT '' NOT NULL,
	"reason" text NOT NULL,
	"ip" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"hit_count" integer DEFAULT 1 NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"token_id" uuid,
	"at" timestamp NOT NULL,
	"tool" text,
	"outcome" text NOT NULL,
	"deny_reason" text,
	"error_code" text,
	"args_summary" jsonb,
	"result_count" integer,
	"ip" text,
	"country" text,
	"write_before" jsonb,
	"write_after" jsonb,
	"hit_count" integer DEFAULT 1 NOT NULL,
	"window_start" timestamp
);
--> statement-breakpoint
CREATE TABLE "mcp_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_id" uuid NOT NULL,
	"key" text NOT NULL,
	"tool" text NOT NULL,
	"args_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lookup_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"allowed_cidrs" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_alert_state" ADD CONSTRAINT "mcp_alert_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_alert_state" ADD CONSTRAINT "mcp_alert_state_token_id_mcp_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."mcp_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ADD CONSTRAINT "mcp_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ADD CONSTRAINT "mcp_audit_log_token_id_mcp_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."mcp_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_idempotency" ADD CONSTRAINT "mcp_idempotency_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_idempotency" ADD CONSTRAINT "mcp_idempotency_token_id_mcp_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."mcp_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mcp_alert_state_window" ON "mcp_alert_state" USING btree ("user_id","token_key","reason","ip","window_start");--> statement-breakpoint
CREATE INDEX "idx_mcp_alert_state_user_sent" ON "mcp_alert_state" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX "idx_mcp_audit_user_at" ON "mcp_audit_log" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "idx_mcp_audit_user_token_at" ON "mcp_audit_log" USING btree ("user_id","token_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mcp_audit_unauth_window" ON "mcp_audit_log" USING btree ("ip","deny_reason","window_start") WHERE "mcp_audit_log"."window_start" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mcp_idempotency_token_key" ON "mcp_idempotency" USING btree ("token_id","key");--> statement-breakpoint
CREATE INDEX "idx_mcp_idempotency_created" ON "mcp_idempotency" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mcp_tokens_lookup_id" ON "mcp_tokens" USING btree ("lookup_id");--> statement-breakpoint
CREATE INDEX "idx_mcp_tokens_user" ON "mcp_tokens" USING btree ("user_id");