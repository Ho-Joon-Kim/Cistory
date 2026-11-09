import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "레포지토리",
};

export default function RepositoriesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
