"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageContainer } from "@/components/ds";
import { Header } from "@/components/Layout/Header";
import { useRequireAuth } from "@/modules/auth/hooks";
import { SearchView } from "@/modules/search/components/SearchView";

function SearchFromUrl() {
  const params = useSearchParams();
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
      <PageContainer className="pt-5 lg:pt-10">
        {/* A history change restores the box and results together. */}
        <SearchView
          key={params.toString()}
          params={new URLSearchParams(params.toString())}
          enabled={isAuthenticated}
        />
      </PageContainer>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-8 text-sm text-ink-2">
          검색 화면을 불러오는 중…
        </p>
      }
    >
      <SearchFromUrl />
    </Suspense>
  );
}
