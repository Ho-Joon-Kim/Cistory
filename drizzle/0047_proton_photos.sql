CREATE TABLE "photo_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_uid" text NOT NULL,
	"blocked_at" timestamp NOT NULL,
	"model_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_thumbnails" (
	"photo_id" uuid PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL,
	"fetched_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_uid" text NOT NULL,
	"main_photo_node_uid" text,
	"content_hash" text,
	"captured_at" timestamp NOT NULL,
	"media_type" text,
	"width" integer,
	"height" integer,
	"duration_sec" double precision,
	"lat" double precision,
	"lon" double precision,
	"location_source" text,
	"location_gap_sec" integer,
	"device" text,
	"tags" integer[],
	"claimed_metadata" jsonb,
	"trashed_at" timestamp,
	"deleted_at" timestamp,
	"details_synced_at" timestamp,
	"location_checked_at" timestamp,
	"details_attempts" integer DEFAULT 0 NOT NULL,
	"details_error" text,
	"thumbnail_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proton_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"uid_enc" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"key_password_enc" text,
	"status" text NOT NULL,
	"pending_fork_selector" text,
	"pending_fork_key_enc" text,
	"pending_fork_expires_at" timestamp,
	"volume_id" text,
	"event_cursor" text,
	"timeline_listed_at" timestamp,
	"backfill_completed_at" timestamp,
	"last_synced_at" timestamp,
	"last_error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photo_blocks" ADD CONSTRAINT "photo_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_thumbnails" ADD CONSTRAINT "photo_thumbnails_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proton_connections" ADD CONSTRAINT "proton_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_photo_blocks_user_node" ON "photo_blocks" USING btree ("user_id","node_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_photos_user_node" ON "photos" USING btree ("user_id","node_uid");--> statement-breakpoint
CREATE INDEX "idx_photos_user_captured" ON "photos" USING btree ("user_id","captured_at");--> statement-breakpoint
CREATE INDEX "idx_photos_user_main" ON "photos" USING btree ("user_id","main_photo_node_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_proton_conn_user" ON "proton_connections" USING btree ("user_id");