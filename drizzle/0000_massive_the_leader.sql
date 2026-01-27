CREATE TABLE "commit_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"commit_id" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'pending',
	"retry_count" integer DEFAULT 0,
	"error_message" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "commit_summaries_commit_id_unique" UNIQUE("commit_id")
);
--> statement-breakpoint
CREATE TABLE "commits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"sha" text NOT NULL,
	"message" text NOT NULL,
	"author_name" text NOT NULL,
	"author_email" text,
	"author_avatar_url" text,
	"committed_at" timestamp NOT NULL,
	"additions" integer DEFAULT 0,
	"deletions" integer DEFAULT 0,
	"changed_files_count" integer DEFAULT 0,
	"is_merge_commit" boolean DEFAULT false,
	"parent_shas" text,
	"repo_full_name" text NOT NULL,
	"repo_id" integer,
	"repo_is_private" boolean DEFAULT false,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"sync_type" text NOT NULL,
	"status" text DEFAULT 'pending',
	"trigger_type" text NOT NULL,
	"total_commits" integer DEFAULT 0,
	"processed_commits" integer DEFAULT 0,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"github_id" integer NOT NULL,
	"github_login" text NOT NULL,
	"github_avatar_url" text,
	"github_access_token" text NOT NULL,
	"theme" text DEFAULT 'system',
	"sync_interval_hours" integer DEFAULT 1,
	"last_synced_at" timestamp,
	"initial_sync_completed" boolean DEFAULT false,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
ALTER TABLE "commit_summaries" ADD CONSTRAINT "commit_summaries_commit_id_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_summary_commit_id" ON "commit_summaries" USING btree ("commit_id");--> statement-breakpoint
CREATE INDEX "idx_summary_status" ON "commit_summaries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_commit_user_id" ON "commits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_commit_committed_at" ON "commits" USING btree ("committed_at");--> statement-breakpoint
CREATE INDEX "idx_commit_repo_full_name" ON "commits" USING btree ("repo_full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_commit_user_sha" ON "commits" USING btree ("user_id","sha");--> statement-breakpoint
CREATE INDEX "idx_sync_user_id" ON "sync_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sync_status" ON "sync_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sync_created_at" ON "sync_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_user_github_id" ON "users" USING btree ("github_id");