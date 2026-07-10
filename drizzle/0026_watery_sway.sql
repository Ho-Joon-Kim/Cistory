CREATE TABLE "body_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"withings_group_id" bigint NOT NULL,
	"measured_at" timestamp NOT NULL,
	"category" integer,
	"weight_kg" numeric,
	"fat_mass_kg" numeric,
	"fat_free_mass_kg" numeric,
	"muscle_mass_kg" numeric,
	"bone_mass_kg" numeric,
	"hydration_kg" numeric,
	"fat_ratio_pct" numeric,
	"heart_rate_bpm" integer,
	"visceral_fat" numeric,
	"bmr_kcal" numeric,
	"metabolic_age" integer,
	"raw_measures" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withings_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"withings_user_id" text,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"access_token_expires_at" timestamp,
	"scope" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_measure_update" bigint,
	"last_synced_at" timestamp,
	"last_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withings_connections" ADD CONSTRAINT "withings_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_body_measurement_unique" ON "body_measurements" USING btree ("user_id","withings_group_id");--> statement-breakpoint
CREATE INDEX "idx_body_measurement_user_time" ON "body_measurements" USING btree ("user_id","measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_withings_conn_user" ON "withings_connections" USING btree ("user_id");