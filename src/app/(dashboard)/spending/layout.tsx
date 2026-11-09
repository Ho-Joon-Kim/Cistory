import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "소비",
  description: "Toss 알림으로 수집된 소비와 입금 내역을 확인합니다.",
};

export default function SpendingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
