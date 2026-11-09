import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "설정",
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
