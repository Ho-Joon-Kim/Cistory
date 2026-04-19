"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { authClient } from "@/lib/auth-client";

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
  const { data: sessionData, isPending, refetch } = authClient.useSession();

  const user: User | null = sessionData?.user
    ? {
        id: sessionData.user.id,
        name: sessionData.user.name || sessionData.user.email?.split("@")[0] || "User",
        email: sessionData.user.email || null,
        image: sessionData.user.image || null,
      }
    : null;

  const session: Session | null = sessionData?.session
    ? {
        user: user!,
        expiresAt: sessionData.session.expiresAt
          ? new Date(sessionData.session.expiresAt).toISOString()
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }
    : null;

  const signIn = useCallback(async () => {
    await authClient.signIn.social({
      provider: "github",
      callbackURL: "/dashboard",
    });
  }, []);

  const signOut = useCallback(async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/login";
        },
      },
    });
  }, []);

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    user,
    session,
    isLoading: isPending,
    isAuthenticated: !!user,
    signIn,
    signOut,
    refresh,
  };
}

export function useUser() {
  const { user, isLoading } = useAuth();
  return { user, isLoading };
}

export function useRequireAuth() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isLoading, isAuthenticated, router]);

  return { isLoading, isAuthenticated };
}
