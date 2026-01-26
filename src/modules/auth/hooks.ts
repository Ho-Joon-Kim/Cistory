"use client";

import { useCallback, useEffect, useState } from "react";

interface User {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  githubId?: number;
  theme?: string;
  syncIntervalHours?: number;
}

interface Session {
  user: User;
  expiresAt: string;
}

interface UseAuthReturn {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/get-session", {
        credentials: "include",
      });

      if (response.ok) {
        const data = (await response.json()) as Session;
        setSession(data);
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const signIn = useCallback(async () => {
    // Better Auth의 소셜 로그인 경로
    const response = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: "github",
        callbackURL: "/callback",
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
      });
      setSession(null);
      window.location.href = "/login";
    } catch (error) {
      console.error("Sign out error:", error);
    }
  }, []);

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
