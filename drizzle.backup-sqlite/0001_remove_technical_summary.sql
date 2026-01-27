-- Remove technical summary feature
-- Rename non_technical_summary to summary and drop technical_summary column

ALTER TABLE "commit_summaries" RENAME COLUMN "non_technical_summary" TO "summary";--> statement-breakpoint
ALTER TABLE "commit_summaries" DROP COLUMN IF EXISTS "technical_summary";
