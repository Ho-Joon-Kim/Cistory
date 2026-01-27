import { createRouteHandlerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/db'
import { users } from '@/db/schema'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createRouteHandlerClient()

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('[Auth Callback] Error exchanging code:', error.message)
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)
    }

    // Ensure user record exists in our database
    if (data.session && data.user) {
      try {
        const { user, session } = data
        const githubToken = session.provider_token

        if (!githubToken) {
          console.error('No provider token in session')
          return NextResponse.redirect(`${origin}/login?error=no_token`)
        }

        // Fetch GitHub user details
        const githubResponse = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        })

        if (!githubResponse.ok) {
          console.error('[Auth Callback] Failed to fetch GitHub user')
          return NextResponse.redirect(`${origin}/login?error=github_fetch_failed`)
        }

        const githubUser = await githubResponse.json()
        const db = getDb()

        // Upsert user record
        const now = new Date()
        await db
          .insert(users)
          .values({
            id: user.id,
            githubId: githubUser.id,
            githubLogin: githubUser.login,
            githubAvatarUrl: githubUser.avatar_url,
            githubAccessToken: githubToken,
            theme: 'system',
            syncIntervalHours: 1,
            initialSyncCompleted: false,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: users.id,
            set: {
              githubAccessToken: githubToken,
              githubAvatarUrl: githubUser.avatar_url,
              githubLogin: githubUser.login,
              updatedAt: now,
            },
          })
      } catch (dbError) {
        console.error('[Auth Callback] Error ensuring user:', dbError)
        // Continue to redirect even if DB error occurs
      }
    }
  }

  // URL to redirect to after sign in process completes
  return NextResponse.redirect(`${origin}${next}`)
}
