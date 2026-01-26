CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `commit_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`commit_id` text NOT NULL,
	`technical_summary` text,
	`non_technical_summary` text,
	`status` text DEFAULT 'pending',
	`retry_count` integer DEFAULT 0,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`commit_id`) REFERENCES `commits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commit_summaries_commit_id_unique` ON `commit_summaries` (`commit_id`);--> statement-breakpoint
CREATE INDEX `idx_summary_commit_id` ON `commit_summaries` (`commit_id`);--> statement-breakpoint
CREATE INDEX `idx_summary_status` ON `commit_summaries` (`status`);--> statement-breakpoint
CREATE TABLE `commits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sha` text NOT NULL,
	`message` text NOT NULL,
	`author_name` text NOT NULL,
	`author_email` text,
	`author_avatar_url` text,
	`committed_at` text NOT NULL,
	`additions` integer DEFAULT 0,
	`deletions` integer DEFAULT 0,
	`changed_files_count` integer DEFAULT 0,
	`is_merge_commit` integer DEFAULT false,
	`parent_shas` text,
	`repo_full_name` text NOT NULL,
	`repo_id` integer,
	`repo_is_private` integer DEFAULT false,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_commit_user_id` ON `commits` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_commit_committed_at` ON `commits` (`committed_at`);--> statement-breakpoint
CREATE INDEX `idx_commit_repo_full_name` ON `commits` (`repo_full_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commit_user_sha` ON `commits` (`user_id`,`sha`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sync_type` text NOT NULL,
	`status` text DEFAULT 'pending',
	`trigger_type` text NOT NULL,
	`total_commits` integer DEFAULT 0,
	`processed_commits` integer DEFAULT 0,
	`error_message` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sync_user_id` ON `sync_jobs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sync_status` ON `sync_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sync_created_at` ON `sync_jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` integer NOT NULL,
	`github_login` text NOT NULL,
	`github_avatar_url` text,
	`github_access_token` text NOT NULL,
	`theme` text DEFAULT 'system',
	`sync_interval_hours` integer DEFAULT 1,
	`last_synced_at` text,
	`initial_sync_completed` integer DEFAULT false,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_id_unique` ON `users` (`github_id`);--> statement-breakpoint
CREATE INDEX `idx_user_github_id` ON `users` (`github_id`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
