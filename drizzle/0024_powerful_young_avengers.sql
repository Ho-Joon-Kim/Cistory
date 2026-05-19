ALTER TABLE "brokerage_accounts" ADD COLUMN "opened_at" text;--> statement-breakpoint
ALTER TABLE "brokerage_accounts" ADD COLUMN "executions_backfilled_from" text;--> statement-breakpoint
ALTER TABLE "brokerage_accounts" ADD COLUMN "pnl_backfilled_from" text;