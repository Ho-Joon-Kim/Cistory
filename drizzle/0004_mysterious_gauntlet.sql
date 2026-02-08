CREATE TABLE "coding_daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"total_seconds" integer DEFAULT 0 NOT NULL,
	"projects" text,
	"languages" text,
	"editors" text,
	"categories" text,
	"calculated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coding_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project" text,
	"started_at" timestamp NOT NULL,
	"duration_seconds" integer NOT NULL,
	"human_additions" integer,
	"human_deletions" integer,
	"ai_additions" integer,
	"ai_deletions" integer,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wakatime_api_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wakatime_last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "coding_daily_stats" ADD CONSTRAINT "coding_daily_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coding_sessions" ADD CONSTRAINT "coding_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_coding_daily_stats_user_date" ON "coding_daily_stats" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "idx_coding_session_user_started" ON "coding_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_coding_session_unique" ON "coding_sessions" USING btree ("user_id","started_at","project");