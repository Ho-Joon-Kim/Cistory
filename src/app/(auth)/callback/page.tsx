"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoadingState } from "@/components/ds";

export default function CallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // Better Auth handles the callback via [...all] route.
    // This page is a fallback — redirect to dashboard.
    router.replace("/dashboard");
  }, [router]);

  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-page p-4">
      <div className="surface flex w-full max-w-[400px] flex-col gap-4 p-6 sm:p-8">
        <h1 className="m-0 font-serif text-2xl leading-8 font-bold tracking-[-0.02em]">
          로그인 처리 중…
        </h1>
        <p className="m-0 text-sm text-ink-2">잠시만 기다려 주세요.</p>
        <LoadingState variant="rows" rows={2} label="로그인 처리 중" />
      </div>
    </main>
  );
}
