"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { GithubMark } from "@/components/GithubMark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/modules/auth/hooks";

export default function LoginPage() {
  const { signIn, isLoading } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="border-b border-line">
        <div className="mx-auto flex h-[52px] max-w-[1440px] items-center px-page lg:h-16">
          <span className="font-serif text-lg font-bold tracking-[-0.02em] text-ink lg:text-xl">
            Cistory
          </span>
        </div>
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="ds-enter surface flex w-full max-w-[400px] flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 font-serif text-[26px] leading-[34px] font-bold tracking-[-0.02em] sm:text-[32px] sm:leading-10">
              로그인
            </h1>
            <p className="m-0 text-sm leading-[22px] text-ink-2">
              커밋·위치·소비·건강 기록을 한 곳에 모아 하루와 기간을 돌아봐요.
            </p>
          </div>
          <Button onClick={() => signIn()} className="h-11 w-full" disabled={isLoading}>
            {isLoading ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <GithubMark className="size-5" />
            )}
            {isLoading ? "로그인 중…" : "GitHub로 로그인"}
          </Button>
          <p className="m-0 text-[13px] leading-5 text-ink-3">
            로그인할 때 레포지토리 읽기 권한을 요청해요. 비공개 레포지토리의 커밋도 기록할 수
            있어요.
          </p>
          <div className="flex items-center gap-3 border-t border-line pt-4 text-xs text-ink-3">
            <Link href="/privacy" className="text-ink-2 hover:underline">
              개인정보처리방침
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/terms" className="text-ink-2 hover:underline">
              이용약관
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
