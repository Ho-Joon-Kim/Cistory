CREATE TABLE "brokerage_target_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"target_weight" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brokerage_target_allocations" ADD CONSTRAINT "brokerage_target_allocations_account_id_brokerage_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."brokerage_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_target_alloc_account" ON "brokerage_target_allocations" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_target_alloc_unique" ON "brokerage_target_allocations" USING btree ("account_id","ticker");