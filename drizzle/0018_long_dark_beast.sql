CREATE TABLE "fog_cells_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"calculated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fog_cells_cache" ADD CONSTRAINT "fog_cells_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_fog_cells_unique" ON "fog_cells_cache" USING btree ("user_id","lat","lon");--> statement-breakpoint
CREATE INDEX "idx_fog_cells_user" ON "fog_cells_cache" USING btree ("user_id");