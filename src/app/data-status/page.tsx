"use client";

import { PageContainer } from "@/components/ds";
import { Header } from "@/components/Layout/Header";
import { useRequireAuth } from "@/modules/auth/hooks";
import { DataStatusView } from "@/modules/data-status/components/DataStatusView";

export default function DataStatusPage() {
  const { isLoading, isAuthenticated } = useRequireAuth();
  if (isLoading)
    return (
      <p role="status" className="p-8 text-sm text-ink-2">
        로그인 확인 중…
      </p>
    );
  if (!isAuthenticated) return null;
  return (
    <div className="min-h-screen bg-page">
      <Header />
      <PageContainer>
        <DataStatusView enabled={isAuthenticated} />
      </PageContainer>
    </div>
  );
}
