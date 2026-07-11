DROP INDEX "idx_health_sample_unique";--> statement-breakpoint
ALTER TABLE "health_samples" ADD COLUMN "source" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_health_sample_unique" ON "health_samples" USING btree ("user_id","metric","sample_at","source");