import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "타임라인",
  description: "지도와 함께 커밋, 장소, 소비 기록을 날짜별로 확인합니다.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
