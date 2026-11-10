ALTER TABLE "photos" ADD COLUMN "original_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "original_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "original_error" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "image_direction" double precision;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "image_direction_ref" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "capture_utc_offset_min" integer;