import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "포트폴리오",
};

export default function PortfolioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
