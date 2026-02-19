"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  const handleCallback = useCallback(async () => {
    const errorParam = searchParams.get("error");

    if (errorParam) {
      router.replace(`/login?error=${encodeURIComponent(errorParam)}`);
      return;
    }

    const code = searchParams.get("code");

    if (!code) {
      router.replace("/login?error=no_code");
      return;
    }

    try {
      const supabase = createClient();
      const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

      if (exchangeError) {
        console.error("[Callback] Error exchanging code:", exchangeError);
        setError(exchangeError.message);
        setTimeout(() => {
          router.replace(`/login?error=${encodeURIComponent(exchangeError.message)}`);
        }, 2000);
        return;
      }

      // Now call API to ensure user record exists
      if (data.session && data.user) {
        const response = await fetch("/api/auth/ensure-user", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          console.error("[Callback] Failed to ensure user");
        }
      }

      // Redirect to dashboard
      router.replace("/dashboard");
    } catch (err) {
      console.error("[Callback] Error:", err);
      setError("인증 처리 중 오류가 발생했습니다");
      setTimeout(() => {
        router.replace("/login");
      }, 2000);
    }
  }, [router, searchParams]);

  useEffect(() => {
    handleCallback();
  }, [handleCallback]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            {error ? "로그인 실패" : "로그인 처리 중..."}
          </CardTitle>
          <CardDescription>
            {error ? error : "잠시만 기다려주세요"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">로그인 처리 중...</CardTitle>
            <CardDescription>잠시만 기다려주세요</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
