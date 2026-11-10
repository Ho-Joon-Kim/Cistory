"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoadingState, PageContainer } from "@/components/ds";
import { Header } from "@/components/Layout/Header";
import { useAuth } from "@/modules/auth/hooks";
import { SettingsForm } from "@/modules/settings/components/SettingsForm";

export default function SettingsPage() {
  const router = useRouter();
  const { isLoading: isAuthLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthLoading, isAuthenticated, router]);

  if (isAuthLoading) {
    return (
      <div className="mx-auto max-w-[760px] p-8">
        <LoadingState variant="rows" rows={6} label="로딩 중" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-page">
      <Header />
      <PageContainer>
        <SettingsForm />
      </PageContainer>
    </div>
  );
}
