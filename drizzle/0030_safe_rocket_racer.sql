CREATE TABLE "period_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period_type" text NOT NULL,
	"period_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"compute_started_at" timestamp,
	"lease_expires_at" timestamp,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"finalized_at" timestamp,
	"compute_version" integer DEFAULT 1 NOT NULL,
	"coding" jsonb,
	"location" jsonb,
	"health" jsonb,
	"spending" jsonb,
	"assets" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "period_snapshots" ADD CONSTRAINT "period_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_period_snapshot_user_period" ON "period_snapshots" USING btree ("user_id","period_type","period_key");