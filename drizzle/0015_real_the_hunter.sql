ALTER TABLE "transactions" ADD COLUMN "is_self_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "location_points" DROP COLUMN "trigger";--> statement-breakpoint
ALTER TABLE "saved_places" DROP COLUMN "icon";--> statement-breakpoint
ALTER TABLE "saved_places" DROP COLUMN "color";--> statement-breakpoint
ALTER TABLE "trips" DROP COLUMN "auto_detected";