CREATE TABLE "period_narratives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period_type" text NOT NULL,
	"period_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"content" text,
	"generation_started_at" timestamp,
	"lease_expires_at" timestamp,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"generated_at" timestamp,
	"model" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "period_narratives" ADD CONSTRAINT "period_narratives_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_period_narrative_user_period" ON "period_narratives" USING btree ("user_id","period_type","period_key");--> statement-breakpoint
CREATE INDEX "idx_period_narrative_queue" ON "period_narratives" USING btree ("status","lease_expires_at");