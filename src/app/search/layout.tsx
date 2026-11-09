import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "검색",
};

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
