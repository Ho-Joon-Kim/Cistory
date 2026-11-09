import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "수집 상태",
};

export default function DataStatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
