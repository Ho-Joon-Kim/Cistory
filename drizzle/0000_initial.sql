-- Migration: Initial Schema (Events API Version)
-- Created: 2026-01-26

-- Better Auth Tables
CREATE TABLE IF NOT EXISTS `user` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL UNIQUE,
  `email_verified` integer DEFAULT 0,
  `image` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `session` (
  `id` text PRIMARY KEY NOT NULL,
  `expires_at` integer NOT NULL,
  `token` text NOT NULL UNIQUE,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `ip_address` text,
  `user_agent` text,
  `user_id` text NOT NULL REFERENCES `user` (`id`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS `account` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `user_id` text NOT NULL REFERENCES `user` (`id`) ON DELETE CASCADE,
  `access_token` text,
  `refresh_token` text,
  `id_token` text,
  `access_token_expires_at` integer,
  `refresh_token_expires_at` integer,
  `scope` text,
  `password` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `verification` (
  `id` text PRIMARY KEY NOT NULL,
  `identifier` text NOT NULL,
  `value` text NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer,
  `updated_at` integer
);

-- App Users table (Extended)
CREATE TABLE IF NOT EXISTS `users` (
  `id` text PRIMARY KEY NOT NULL,
  `github_id` integer NOT NULL UNIQUE,
  `github_login` text NOT NULL,
  `github_avatar_url` text,
  `github_access_token` text NOT NULL,
  `theme` text DEFAULT 'system',
  `sync_interval_hours` integer DEFAULT 1,
  `last_synced_at` text,
  `initial_sync_completed` integer DEFAULT 0,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_user_github_id` ON `users` (`github_id`);

-- Commits table (user-based, no repository FK)
CREATE TABLE IF NOT EXISTS `commits` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
  `sha` text NOT NULL,
  `message` text NOT NULL,
  `author_name` text NOT NULL,
  `author_email` text,
  `author_avatar_url` text,
  `committed_at` text NOT NULL,
  `additions` integer DEFAULT 0,
  `deletions` integer DEFAULT 0,
  `changed_files_count` integer DEFAULT 0,
  `is_merge_commit` integer DEFAULT 0,
  `parent_shas` text,
  `repo_full_name` text NOT NULL,
  `repo_id` integer,
  `repo_is_private` integer DEFAULT 0,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_commit_user_id` ON `commits` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_commit_committed_at` ON `commits` (`committed_at`);
CREATE INDEX IF NOT EXISTS `idx_commit_repo_full_name` ON `commits` (`repo_full_name`);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_commit_user_sha` ON `commits` (`user_id`, `sha`);

-- Commit Summaries table
CREATE TABLE IF NOT EXISTS `commit_summaries` (
  `id` text PRIMARY KEY NOT NULL,
  `commit_id` text NOT NULL UNIQUE REFERENCES `commits` (`id`) ON DELETE CASCADE,
  `technical_summary` text,
  `non_technical_summary` text,
  `status` text DEFAULT 'pending',
  `retry_count` integer DEFAULT 0,
  `error_message` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_summary_commit_id` ON `commit_summaries` (`commit_id`);
CREATE INDEX IF NOT EXISTS `idx_summary_status` ON `commit_summaries` (`status`);

-- Sync Jobs table (user-based, no repository FK)
CREATE TABLE IF NOT EXISTS `sync_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users` (`id`) ON DELETE CASCADE,
  `sync_type` text NOT NULL,
  `status` text DEFAULT 'pending',
  `trigger_type` text NOT NULL,
  `total_commits` integer DEFAULT 0,
  `processed_commits` integer DEFAULT 0,
  `error_message` text,
  `started_at` text,
  `completed_at` text,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_sync_user_id` ON `sync_jobs` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_sync_status` ON `sync_jobs` (`status`);
CREATE INDEX IF NOT EXISTS `idx_sync_created_at` ON `sync_jobs` (`created_at`);
