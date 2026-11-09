import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "건강",
};

export default function HealthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
