import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "리포트 | Cistory",
};

export default function ReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
