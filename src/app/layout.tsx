import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Cistory - GitHub Commit Timeline",
    template: "%s | Cistory",
  },
  description: "GitHub 커밋 히스토리를 AI 요약과 함께 타임라인으로 시각화합니다. 기술자와 비기술자 모두를 위한 커밋 이해.",
  keywords: ["GitHub", "커밋", "타임라인", "AI 요약", "개발자 도구", "버전 관리"],
  authors: [{ name: "Cistory Team" }],
  creator: "Cistory",
  metadataBase: new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000"),
  openGraph: {
    type: "website",
    locale: "ko_KR",
    title: "Cistory - GitHub Commit Timeline",
    description: "GitHub 커밋 히스토리를 AI 요약과 함께 타임라인으로 시각화",
    siteName: "Cistory",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cistory - GitHub Commit Timeline",
    description: "GitHub 커밋 히스토리를 AI 요약과 함께 타임라인으로 시각화",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
