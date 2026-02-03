"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getAppUrl } from "@/lib/utils";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface User {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  githubId?: number;
  githubUsername?: string;
  theme?: string;
  syncIntervalHours?: number;
}

interface Session {
  user: User;
  expiresAt: string;
}

function transformSupabaseUser(user: SupabaseUser): User {
  return {
    id: user.id,
    name: user.user_metadata?.name || user.email?.split("@")[0] || "User",
    email: user.email || null,
    image: user.user_metadata?.avatar_url || null,
    githubUsername: user.user_metadata?.user_name || user.user_metadata?.preferred_username || undefined,
  };
}

interface UseAuthReturn {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

  const fetchSession = useCallback(async () => {
    try {
      const { data: { session: supabaseSession } } = await supabase.auth.getSession();

      if (supabaseSession?.user) {
        setSession({
          user: transformSupabaseUser(supabaseSession.user),
          expiresAt: supabaseSession.expires_at
            ? new Date(supabaseSession.expires_at * 1000).toISOString()
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });
      } else {
        setSession(null);
      }
    } catch (error) {
      console.error("Fetch session error:", error);
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchSession();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setSession({
          user: transformSupabaseUser(session.user),
          expiresAt: session.expires_at
            ? new Date(session.expires_at * 1000).toISOString()
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });
      } else {
        setSession(null);
      }
      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase, fetchSession]);

  const signIn = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: `${getAppUrl()}/api/auth/callback`,
          scopes: 'repo read:user',
        },
      });

      if (error) {
        console.error('Sign in error:', error);
      }
    } catch (error) {
      console.error('Sign in error:', error);
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      setSession(null);
      window.location.href = "/login";
    } catch (error) {
      console.error("Sign out error:", error);
    }
  }, [supabase]);

  const refresh = useCallback(async () => {
    await fetchSession();
  }, [fetchSession]);

  return {
    user: session?.user ?? null,
    session,
    isLoading,
    isAuthenticated: !!session?.user,
    signIn,
    signOut,
    refresh,
  };
}

export function useUser() {
  const { user, isLoading } = useAuth();
  return { user, isLoading };
}
