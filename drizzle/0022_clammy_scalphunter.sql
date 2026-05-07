CREATE TABLE "brokerage_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"broker" text DEFAULT 'kis' NOT NULL,
	"cano" text NOT NULL,
	"acnt_prdt_cd" text NOT NULL,
	"account_type" text NOT NULL,
	"app_key_enc" text NOT NULL,
	"app_secret_enc" text NOT NULL,
	"access_token" text,
	"access_token_expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp,
	"last_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brokerage_daily_pnl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"trade_date" text NOT NULL,
	"buy_amount" numeric NOT NULL,
	"sell_amount" numeric NOT NULL,
	"realized_pnl" numeric NOT NULL,
	"fee" numeric NOT NULL,
	"tax" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brokerage_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"odno" text NOT NULL,
	"ord_dt" text NOT NULL,
	"ord_time" text,
	"side" text NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"order_qty" numeric NOT NULL,
	"filled_qty" numeric NOT NULL,
	"filled_amount" numeric NOT NULL,
	"avg_price" numeric NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"raw_data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holding_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"quantity" numeric NOT NULL,
	"avg_price" numeric NOT NULL,
	"current_price" numeric NOT NULL,
	"eval_amount" numeric NOT NULL,
	"pnl" numeric NOT NULL,
	"pnl_rate" numeric,
	"weight" numeric NOT NULL,
	"market" text,
	"raw_data" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holding_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"taken_at" timestamp NOT NULL,
	"as_of_date" text NOT NULL,
	"total_eval_amount" numeric NOT NULL,
	"securities_eval_amount" numeric NOT NULL,
	"deposit" numeric NOT NULL,
	"total_purchase_amount" numeric NOT NULL,
	"total_pnl" numeric NOT NULL,
	"total_pnl_rate" numeric,
	"realized_pnl" numeric,
	"prev_day_total_asset" numeric,
	"asset_icdc_amt" numeric,
	"raw_output2" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brokerage_accounts" ADD CONSTRAINT "brokerage_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brokerage_daily_pnl" ADD CONSTRAINT "brokerage_daily_pnl_account_id_brokerage_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."brokerage_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brokerage_executions" ADD CONSTRAINT "brokerage_executions_account_id_brokerage_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."brokerage_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_positions" ADD CONSTRAINT "holding_positions_snapshot_id_holding_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."holding_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_snapshots" ADD CONSTRAINT "holding_snapshots_account_id_brokerage_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."brokerage_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_brokerage_user" ON "brokerage_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_brokerage_user_cano" ON "brokerage_accounts" USING btree ("user_id","cano","acnt_prdt_cd");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_daily_pnl_unique" ON "brokerage_daily_pnl" USING btree ("account_id","trade_date");--> statement-breakpoint
CREATE INDEX "idx_exec_account_date" ON "brokerage_executions" USING btree ("account_id","ord_dt");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_exec_unique" ON "brokerage_executions" USING btree ("account_id","odno","ord_dt");--> statement-breakpoint
CREATE INDEX "idx_position_snapshot" ON "holding_positions" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "idx_position_ticker" ON "holding_positions" USING btree ("ticker","snapshot_id");--> statement-breakpoint
CREATE INDEX "idx_snapshot_account_date" ON "holding_snapshots" USING btree ("account_id","as_of_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_snapshot_unique" ON "holding_snapshots" USING btree ("account_id","as_of_date");