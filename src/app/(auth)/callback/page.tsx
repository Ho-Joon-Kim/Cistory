"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // Better Auth handles the callback via [...all] route.
    // This page is a fallback — redirect to dashboard.
    router.replace("/dashboard");
  }, [router]);

  return (
    <main id="main" className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">로그인 처리 중…</CardTitle>
          <CardDescription>잠시만 기다려 주세요.</CardDescription>
        </CardHeader>
        <CardContent role="status" className="flex justify-center">
          <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="sr-only">로그인 처리 중…</span>
        </CardContent>
      </Card>
    </main>
  );
}
