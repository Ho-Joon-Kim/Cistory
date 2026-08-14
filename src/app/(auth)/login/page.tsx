"use client";

import { Loader2 } from "lucide-react";
import { GithubMark } from "@/components/GithubMark";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/modules/auth/hooks";

export default function LoginPage() {
  const { signIn, isLoading } = useAuth();

  const handleGitHubLogin = async () => {
    await signIn();
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
          <Button onClick={handleGitHubLogin} className="w-full" size="lg" disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <GithubMark className="mr-2 h-5 w-5" />
            )}
            {isLoading ? "로그인 중..." : "GitHub로 로그인"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            로그인 시 레포지토리 접근 권한을 요청합니다.
            <br />
            비공개 레포지토리도 추적할 수 있습니다.
          </p>
          <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <Link href="/privacy" className="hover:underline">
              개인정보처리방침
            </Link>
            <span aria-hidden>·</span>
            <Link href="/terms" className="hover:underline">
              이용약관
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
