CREATE TABLE "account_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_name" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "spending_override" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "override_note" text;--> statement-breakpoint
ALTER TABLE "account_roles" ADD CONSTRAINT "account_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_account_role_user_name" ON "account_roles" USING btree ("user_id","account_name");