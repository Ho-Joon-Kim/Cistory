"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Header } from "@/components/Layout/Header";
import { useAuth } from "@/modules/auth/hooks";
import { SettingsForm } from "@/modules/settings/components/SettingsForm";

export default function SettingsPage() {
  const router = useRouter();
  const { isLoading: isAuthLoading, isAuthenticated } = useAuth();

  // 인증 체크
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthLoading, isAuthenticated, router]);

  if (isAuthLoading) {
    return (
      <div role="status" className="min-h-screen flex items-center justify-center">
        <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="sr-only">로딩 중…</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header showSync={false} />

      {/* 메인 컨텐츠 */}
      <main id="main" className="container mx-auto max-w-6xl px-4 py-6">
        <h1 className="text-2xl font-bold mb-6">설정</h1>
        <SettingsForm />
      </main>
    </div>
  );
}
