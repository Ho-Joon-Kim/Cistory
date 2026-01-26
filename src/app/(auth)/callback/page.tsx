"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function CallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("로그인 처리 중...");

  useEffect(() => {
    const error = searchParams.get("error");

    if (error) {
      // 에러가 있으면 로그인 페이지로 리다이렉트
      router.replace(`/login?error=${encodeURIComponent(error)}`);
      return;
    }

    // Ensure user record exists in our app's users table
    async function ensureUserAndRedirect() {
      try {
        setStatus("사용자 정보 설정 중...");

        const response = await fetch("/api/auth/ensure-user", {
          method: "POST",
          credentials: "include",
        });

        if (!response.ok) {
          console.error("Failed to ensure user:", await response.text());
          // Still redirect to dashboard, will show error there
        }

        // Redirect to dashboard
        router.replace("/");
      } catch (error) {
        console.error("Error ensuring user:", error);
        // Still redirect to dashboard
        router.replace("/");
      }
    }

    ensureUserAndRedirect();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{status}</CardTitle>
          <CardDescription>잠시만 기다려주세요</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    </div>
  );
}
