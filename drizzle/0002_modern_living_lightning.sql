CREATE TABLE "place_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lat_key" double precision NOT NULL,
	"lon_key" double precision NOT NULL,
	"place_name" text NOT NULL,
	"address" text NOT NULL,
	"category" text,
	"provider" text NOT NULL,
	"resolved_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_place_cache_lat_lon" ON "place_cache" USING btree ("lat_key","lon_key");