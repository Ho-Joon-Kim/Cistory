"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Github, Loader2 } from "lucide-react";
import { useState } from "react";

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);

  const handleGitHubLogin = async () => {
    setIsLoading(true);
    try {
      // Better Auth GitHub OAuth 시작
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
      } else {
        console.error("Login failed:", await response.text());
        setIsLoading(false);
      }
    } catch (error) {
      console.error("Login error:", error);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Cistory</CardTitle>
          <CardDescription>
            GitHub 커밋 히스토리를 AI 요약과 함께
            <br />
            타임라인으로 확인하세요
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleGitHubLogin}
            className="w-full"
            size="lg"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Github className="mr-2 h-5 w-5" />
            )}
            {isLoading ? "로그인 중..." : "GitHub로 로그인"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            로그인 시 레포지토리 접근 권한을 요청합니다.
            <br />
            비공개 레포지토리도 추적할 수 있습니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
