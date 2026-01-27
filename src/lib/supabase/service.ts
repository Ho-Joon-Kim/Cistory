import { createClient } from '@supabase/supabase-js'

/**
 * Service client for server-side operations and cron jobs
 * Uses Service Role Key to bypass Row Level Security (RLS)
 *
 * WARNING: Never expose this client to the browser
 * Only use in:
 * - API routes (server-side)
 * - Cron workers
 * - Background jobs
 */
export function createServiceClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}
