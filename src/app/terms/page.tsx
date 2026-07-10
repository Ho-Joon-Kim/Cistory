import type { Metadata } from "next";
import Link from "next/link";

// Public (no-auth) page — linked from the OAuth consent screen (optional but
// recommended alongside the privacy policy). No middleware gate exists, so a
// plain server component is publicly reachable.

export const metadata: Metadata = {
  title: "이용약관",
  description: "Cistory 이용약관 — 개인용 서비스 제공 조건.",
  robots: { index: true, follow: true },
};

// EDIT ME: contact + effective date before publishing to the OAuth consent screen.
const CONTACT_EMAIL = "liam@everex.co.kr";
const EFFECTIVE_DATE = "2026년 7월 10일";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold mt-8">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Cistory
        </Link>

        <h1 className="text-3xl font-bold mt-4">이용약관</h1>
        <p className="text-sm text-muted-foreground mt-2">시행일: {EFFECTIVE_DATE}</p>

        <Section title="1. 서비스의 성격">
          <p>
            Cistory(이하 "서비스")는 운영자 본인의 활동 데이터를 기록·시각화하기 위한 개인용
            라이프로깅 서비스입니다. 상업적 제공이나 일반 대중을 위한 서비스가 아닙니다.
          </p>
        </Section>

        <Section title="2. 계정 및 연동">
          <p>
            서비스 이용을 위해 GitHub 계정으로 로그인하며, 사용자는 GitHub·Google·Withings·한국투자
            증권 등 외부 서비스를 선택적으로 연동할 수 있습니다. 연동에 사용되는 자격 증명은 사용자
            본인의 책임 하에 관리됩니다.
          </p>
        </Section>

        <Section title="3. 면책">
          <p>
            서비스는 "있는 그대로(as-is)" 제공되며, 특정 목적에의 적합성이나 무중단·무오류 동작을
            보증하지 않습니다. 서비스는 외부 제3자 API(GitHub, Google 등)에 의존하며, 해당 API의
            변경·중단으로 인한 기능 제약에 대해 책임을 지지 않습니다.
          </p>
        </Section>

        <Section title="4. 문의 및 변경">
          <p>
            문의는{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            로 연락 주십시오. 약관이 변경되면 본 페이지를 갱신합니다.
          </p>
        </Section>

        <div className="mt-10 text-sm">
          <Link href="/privacy" className="text-muted-foreground hover:underline">
            개인정보처리방침 →
          </Link>
        </div>
      </div>
    </div>
  );
}
