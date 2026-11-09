import type { Metadata } from "next";
import { Geist_Mono, Noto_Serif_KR } from "next/font/google";
import localFont from "next/font/local";
import { QueryProvider } from "@/components/QueryProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Body: Pretendard (variable, self-hosted from the `pretendard` package). Not
// preloaded — the variable file covers all of Hangul (~2 MB) and is cached
// immutably after the first visit; text renders in the fallback until then.
const pretendard = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
  preload: false,
  fallback: ["Noto Sans KR", "system-ui", "sans-serif"],
});

// Titles and AI lines. Google serves Korean as unicode-range slices, which
// next/font self-hosts; only the slices a page uses are downloaded.
const notoSerifKr = Noto_Serif_KR({
  variable: "--font-noto-serif-kr",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
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
  description:
    "GitHub 커밋 히스토리를 AI 요약과 함께 타임라인으로 시각화합니다. 기술자와 비기술자 모두를 위한 커밋 이해.",
  keywords: ["GitHub", "커밋", "타임라인", "AI 요약", "개발자 도구", "버전 관리"],
  authors: [{ name: "Cistory Team" }],
  creator: "Cistory",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
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
    <html
      lang="ko"
      suppressHydrationWarning
      className={`${pretendard.variable} ${notoSerifKr.variable} ${geistMono.variable}`}
    >
      <body className="antialiased min-h-screen bg-background">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>{children}</QueryProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
