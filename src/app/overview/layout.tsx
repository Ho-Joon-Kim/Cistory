import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "통합 대시보드 | Cistory",
  description: "코딩, 이동, 건강, 소비와 자산 흐름을 한곳에서 확인합니다.",
};

export default function OverviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
