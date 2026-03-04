CREATE TABLE "data_usage_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"table_name" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"estimated_bytes" integer DEFAULT 0 NOT NULL,
	"calculated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_usage_cache" ADD CONSTRAINT "data_usage_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_data_usage_user_table" ON "data_usage_cache" USING btree ("user_id","table_name");--> statement-breakpoint
CREATE INDEX "idx_data_usage_user" ON "data_usage_cache" USING btree ("user_id");