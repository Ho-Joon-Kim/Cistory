-- ============================================================================
-- Cistory Row Level Security (RLS) Policies
-- ============================================================================
-- Run this SQL in Supabase SQL Editor after running migrations
-- This ensures data security at the database level
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. USERS TABLE
-- ----------------------------------------------------------------------------

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can view their own record
CREATE POLICY "users_select_own"
ON users FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Users can update their own record
CREATE POLICY "users_update_own"
ON users FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Service role can manage all users (for Cron worker)
CREATE POLICY "users_service_role_all"
ON users FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 2. COMMITS TABLE
-- ----------------------------------------------------------------------------

-- Enable RLS
ALTER TABLE commits ENABLE ROW LEVEL SECURITY;

-- Users can view their own commits
CREATE POLICY "commits_select_own"
ON commits FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can insert their own commits
CREATE POLICY "commits_insert_own"
ON commits FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Service role can manage all commits (for Cron worker)
CREATE POLICY "commits_service_role_all"
ON commits FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 3. COMMIT SUMMARIES TABLE
-- ----------------------------------------------------------------------------

-- Enable RLS
ALTER TABLE commit_summaries ENABLE ROW LEVEL SECURITY;

-- Users can view summaries of their own commits
CREATE POLICY "commit_summaries_select_own"
ON commit_summaries FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM commits
    WHERE commits.id = commit_summaries.commit_id
    AND commits.user_id = auth.uid()
  )
);

-- Users can insert summaries for their own commits
CREATE POLICY "commit_summaries_insert_own"
ON commit_summaries FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM commits
    WHERE commits.id = commit_summaries.commit_id
    AND commits.user_id = auth.uid()
  )
);

-- Users can update summaries of their own commits
CREATE POLICY "commit_summaries_update_own"
ON commit_summaries FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM commits
    WHERE commits.id = commit_summaries.commit_id
    AND commits.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM commits
    WHERE commits.id = commit_summaries.commit_id
    AND commits.user_id = auth.uid()
  )
);

-- Service role can manage all summaries (for Cron worker)
CREATE POLICY "commit_summaries_service_role_all"
ON commit_summaries FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 4. SYNC JOBS TABLE
-- ----------------------------------------------------------------------------

-- Enable RLS
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

-- Users can view their own sync jobs
CREATE POLICY "sync_jobs_select_own"
ON sync_jobs FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can insert their own sync jobs
CREATE POLICY "sync_jobs_insert_own"
ON sync_jobs FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can update their own sync jobs
CREATE POLICY "sync_jobs_update_own"
ON sync_jobs FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Service role can manage all sync jobs (for Cron worker)
CREATE POLICY "sync_jobs_service_role_all"
ON sync_jobs FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Run these queries to verify RLS is working:

-- 1. Check if RLS is enabled on all tables:
/*
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('users', 'commits', 'commit_summaries', 'sync_jobs');
*/

-- 2. List all policies:
/*
SELECT schemaname, tablename, policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
*/

-- 3. Test as authenticated user (replace 'your-user-id' with actual UUID):
/*
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "your-user-id"}';
SELECT * FROM users;  -- Should only return your own record
RESET ROLE;
*/

-- ============================================================================
-- NOTES
-- ============================================================================
-- - All tables have RLS enabled
-- - Authenticated users can only access their own data
-- - Service role (used by Cron worker) has full access to all data
-- - RLS policies automatically filter queries - no code changes needed!
-- - Drizzle ORM queries from API routes respect RLS when using Anon Key
-- - Cron worker uses Service Role Key to bypass RLS
-- ============================================================================
