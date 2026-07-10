CREATE TABLE "health_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"google_sub" text,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"access_token_expires_at" timestamp,
	"scope" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp,
	"last_sync_error" text,
	"backfill_floor" timestamp,
	"backfill_completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_daily_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"metric" text NOT NULL,
	"value_avg" double precision,
	"value_min" double precision,
	"value_max" double precision,
	"value_sum" double precision,
	"count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_raw_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"data_type" text NOT NULL,
	"method" text NOT NULL,
	"window_start" timestamp,
	"window_end" timestamp,
	"raw_json" jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"sample_at" timestamp NOT NULL,
	"value" double precision,
	"value_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"synced_through" timestamp,
	"backfilled_from" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_connections" ADD CONSTRAINT "health_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_daily_summaries" ADD CONSTRAINT "health_daily_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_raw_pages" ADD CONSTRAINT "health_raw_pages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_samples" ADD CONSTRAINT "health_samples_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_sync_state" ADD CONSTRAINT "health_sync_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_health_conn_user" ON "health_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_health_daily_unique" ON "health_daily_summaries" USING btree ("user_id","metric","day");--> statement-breakpoint
CREATE INDEX "idx_health_raw_pages_user_time" ON "health_raw_pages" USING btree ("user_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_health_sample_unique" ON "health_samples" USING btree ("user_id","metric","sample_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_health_sync_state_unique" ON "health_sync_state" USING btree ("user_id","metric");