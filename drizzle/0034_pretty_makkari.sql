ALTER TABLE "saved_places" ADD COLUMN "exclude_from_trips" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_places" ADD COLUMN "trip_exclusion_radius_m" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "auto_detected" boolean;--> statement-breakpoint
UPDATE "trips" SET "auto_detected" = true;--> statement-breakpoint
ALTER TABLE "trips" ALTER COLUMN "auto_detected" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "trips" ALTER COLUMN "auto_detected" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trip_detection_last_through" text;
