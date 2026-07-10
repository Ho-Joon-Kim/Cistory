import type { Metadata } from "next";
import Link from "next/link";

// Public (no-auth) page — the OAuth consent screen links here, and Google's
// review crawler must reach it without logging in. There is no middleware gate,
// so a plain server component is publicly reachable.

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description: "Cistory 개인정보처리방침 — 수집 데이터, Google 사용자 데이터 사용, 보관·삭제·회수.",
  robots: { index: true, follow: true },
};

// EDIT ME: contact + effective date before publishing to the OAuth consent screen.
const CONTACT_EMAIL = "liam@everex.co.kr";
const EFFECTIVE_DATE = "2026년 7월 10일";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://cistory.app";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold mt-8">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Cistory
        </Link>

        <h1 className="text-3xl font-bold mt-4">개인정보처리방침</h1>
        <p className="text-sm text-muted-foreground mt-2">시행일: {EFFECTIVE_DATE}</p>

        <div className="mt-6 space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p>
            Cistory(이하 "서비스")는 운영자 본인의 활동을 한곳에 기록·시각화하는 개인용 라이프로깅
            서비스입니다. 서비스는 운영자 본인의 데이터만 수집하며, 일반 대중을 위한 회원 가입이나
            제3자에 대한 데이터 제공을 목적으로 하지 않습니다.
          </p>
        </div>

        <Section title="1. 수집하는 데이터">
          <p>서비스는 사용자가 직접 연동한 소스에 한해 다음 데이터를 수집·저장합니다.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>GitHub 커밋 이력 및 저장소 메타데이터</li>
            <li>위치 정보(OwnTracks를 통한 GPS 좌표·이동 기록)</li>
            <li>금융 거래 알림(Toss 푸시 알림 파싱 결과)</li>
            <li>코딩 활동(WakaTime 세션·언어·프로젝트 통계)</li>
            <li>체성분(Withings 체중·체지방 등)</li>
            <li>증권 포트폴리오(한국투자증권 API 보유종목·체결·손익)</li>
            <li>
              건강·피트니스 데이터(Fitbit, Google Health API): 수면, 활동량, 심박수, 산소포화도,
              호흡수, 심박변이도, 체온 관련 등 사용자가 승인한 범위의 데이터
            </li>
          </ul>
        </Section>

        <Section title="2. Google 사용자 데이터의 사용">
          <p>
            서비스는 Google Health API를 통해 <strong>읽기 전용(readonly)</strong> 권한으로만 건강·
            피트니스 데이터에 접근합니다. 접근한 Google 사용자 데이터는 다음 목적에 한해 사용됩니다.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>운영자 본인의 대시보드(/health)에 일별 트렌드를 표시</li>
            <li>월간·연간 개인 리포트 및 인사이트 생성</li>
          </ul>
          <p>
            서비스는 이 데이터를 <strong>제3자에게 판매·양도·공유하지 않으며</strong>, 광고 목적으로
            사용하지 않고, 인간이 열람하지 않으며(운영·보안·법적 요구 또는 사용자 동의 시 제외),
            일반화된 AI/ML 모델의 학습에 사용하지 않습니다.
          </p>
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-foreground">
            <p className="text-sm">
              Cistory의 Google 사용자 데이터에 대한 사용 및 다른 앱으로의 전송은, Google API
              Services User Data Policy(제한적 사용(Limited Use) 요건 포함)를 준수합니다.
            </p>
            <p className="text-xs mt-2 text-muted-foreground">
              Cistory's use and transfer of information received from Google APIs will adhere to the{" "}
              <a
                className="underline"
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
          </div>
        </Section>

        <Section title="3. 저장·보안">
          <p>
            연동 계정의 액세스·리프레시 토큰은 AES-256-GCM으로 암호화하여 서비스 데이터베이스에
            저장합니다. 원본 건강 데이터 페이로드는 애플리케이션 로그나 오류 추적(Sentry)에 남기지
            않습니다. 데이터는 운영자가 관리하는 인프라에 저장됩니다.
          </p>
        </Section>

        <Section title="4. 보관 및 삭제">
          <p>
            수집된 데이터는 사용자가 삭제하기 전까지 보관됩니다. 설정 화면에서 연동을 해제하면 해당
            소스의 동기화가 중단되고 저장된 토큰은 삭제됩니다(과거 기록은 별도 요청 시 삭제).
          </p>
          <p>
            Google 계정에 부여한 권한은{" "}
            <a
              className="underline"
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google 계정 권한 설정
            </a>
            에서 언제든 직접 회수할 수 있습니다.
          </p>
        </Section>

        <Section title="5. 제3자 제공">
          <p>
            서비스는 수집한 개인정보를 제3자에게 제공하지 않습니다. 데이터 수집을 위해 GitHub,
            Google, Withings, 한국투자증권 등 사용자가 직접 연동한 외부 서비스의 API를 이용합니다.
          </p>
        </Section>

        <Section title="6. 문의 및 변경">
          <p>
            본 방침에 대한 문의는{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            로 연락 주십시오. 방침이 변경되면 본 페이지({APP_URL}/privacy)를 갱신합니다.
          </p>
        </Section>

        <div className="mt-10 text-sm">
          <Link href="/terms" className="text-muted-foreground hover:underline">
            이용약관 →
          </Link>
        </div>
      </div>
    </div>
  );
}
