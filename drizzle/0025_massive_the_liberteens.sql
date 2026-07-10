ALTER TABLE "transactions" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_source" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_confidence" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_model" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_error" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "categorized_at" timestamp;