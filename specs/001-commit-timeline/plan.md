# Implementation Plan: Cistory - GitHub Commit Timeline

**Branch**: `001-commit-timeline` | **Date**: 2026-01-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-commit-timeline/spec.md`

## Summary

GitHub 커밋 히스토리를 타임라인으로 시각화하고, AI(Claude)로 기술자/비기술자 관점의 요약을 제공하는 개인용 웹 서비스. OpenNext + Cloudflare Workers로 배포하며, Cloudflare D1을 데이터베이스로 사용.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20+
**Primary Dependencies**: Next.js 15, @opennextjs/cloudflare, shadcn/ui, Tailwind CSS, Drizzle ORM, Better Auth, @anthropic-ai/sdk
**Storage**: Cloudflare D1 (SQLite)
**Testing**: 자동화 테스트 제외 (수동 테스트만)
**Target Platform**: Cloudflare Workers (Edge Runtime)
**Project Type**: Web Application (Full-stack)
**Performance Goals**: 타임라인 로딩 3초 이내, AI 요약 커밋당 10초 이내
**Constraints**: Worker 크기 10MB 이하, D1 용량 10GB 이하
**Scale/Scope**: 개인 도구, 100 동시 사용자

## Constitution Check

*GATE: Constitution이 템플릿 상태이므로 프로젝트별 원칙 적용*

| 원칙 | 상태 | 비고 |
|------|------|------|
| NFR-001: 모듈화 | PASS | Feature-based module 구조 적용 |
| NFR-002: 추상화 | PASS | Adapter 패턴으로 외부 서비스 분리 |
| NFR-003: VCS 확장성 | PASS | VCS 인터페이스 정의 |
| NFR-004: AI 확장성 | PASS | AI 인터페이스 정의 |
| NFR-005: 단일 책임 | PASS | 모듈별 책임 분리 |
| 테스트 자동화 제외 | PASS | 명세서에 명시됨 |

## Project Structure

### Documentation (this feature)

```text
specs/001-commit-timeline/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0: 기술 조사 결과
├── data-model.md        # Phase 1: 데이터 모델
├── quickstart.md        # Phase 1: 개발 환경 설정 가이드
├── contracts/
│   └── api.yaml         # Phase 1: OpenAPI 스펙
├── checklists/
│   └── requirements.md  # 명세서 품질 체크리스트
└── tasks.md             # Phase 2: 구현 태스크 (speckit.tasks에서 생성)
```

### Source Code (repository root)

```text
src/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # 인증 관련 라우트
│   │   ├── login/page.tsx
│   │   └── callback/page.tsx
│   ├── (dashboard)/              # 메인 대시보드
│   │   ├── page.tsx              # 타임라인 메인
│   │   ├── repositories/page.tsx
│   │   └── settings/page.tsx
│   ├── api/                      # API Routes
│   │   ├── auth/[...path]/route.ts
│   │   ├── repositories/route.ts
│   │   ├── timeline/route.ts
│   │   ├── sync/route.ts
│   │   └── settings/route.ts
│   ├── layout.tsx
│   └── globals.css
│
├── modules/                      # Feature Modules (모듈화)
│   ├── auth/                     # GitHub OAuth 인증
│   │   ├── actions.ts
│   │   ├── hooks.ts
│   │   └── components/
│   ├── github/                   # GitHub API 연동
│   │   ├── service.ts
│   │   └── types.ts
│   ├── sync/                     # 동기화 로직
│   │   ├── service.ts
│   │   └── worker.ts
│   ├── summary/                  # AI 요약
│   │   ├── service.ts
│   │   └── prompts.ts
│   └── timeline/                 # 타임라인 UI
│       ├── components/
│       │   ├── Timeline.tsx
│       │   ├── CommitCard.tsx
│       │   └── Filters.tsx
│       └── hooks.ts
│
├── lib/
│   ├── adapters/                 # 외부 서비스 어댑터 (추상화)
│   │   ├── vcs/
│   │   │   ├── interface.ts      # VCS 인터페이스
│   │   │   └── github.ts         # GitHub 구현체
│   │   ├── ai/
│   │   │   ├── interface.ts      # AI 인터페이스
│   │   │   └── claude.ts         # Claude 구현체
│   │   └── db/
│   │       └── d1.ts             # D1 어댑터
│   ├── auth.ts                   # Better Auth 설정
│   └── utils.ts
│
├── components/                   # 공용 UI 컴포넌트
│   ├── ui/                       # shadcn/ui
│   ├── ThemeToggle.tsx
│   └── Layout/
│
└── db/
    ├── schema.ts                 # Drizzle 스키마
    ├── index.ts                  # DB 클라이언트
    └── migrations/

# 설정 파일 (루트)
├── wrangler.jsonc                # Cloudflare 설정
├── drizzle.config.ts             # Drizzle ORM 설정
├── next.config.ts                # Next.js 설정
├── open-next.config.ts           # OpenNext 설정
├── tailwind.config.ts            # Tailwind 설정
├── components.json               # shadcn/ui 설정
└── package.json
```

**Structure Decision**: Feature-based module 아키텍처 채택. 각 모듈(auth, github, sync, summary, timeline)이 독립적으로 개발/테스트 가능. 외부 서비스는 `lib/adapters/` 아래에 인터페이스/구현체로 분리하여 향후 확장성 확보.

## Complexity Tracking

> Constitution 위반 없음 - 해당 섹션 비활성화

## Phase 0 Output

- [research.md](./research.md): 기술 조사 결과
  - OpenNext + Cloudflare Workers 배포 전략
  - Cloudflare D1 + Drizzle ORM 설정
  - GitHub OAuth 연동 (Better Auth)
  - Claude API 프롬프트 설계
  - SSE 기반 실시간 상태 업데이트
  - shadcn/ui 컴포넌트 계획

## Phase 1 Output

- [data-model.md](./data-model.md): 데이터 모델
  - 5개 엔티티: User, Repository, Commit, CommitSummary, SyncJob
  - Drizzle 스키마 정의
  - 주요 쿼리 패턴
- [contracts/api.yaml](./contracts/api.yaml): OpenAPI 스펙
  - Auth, Repositories, Timeline, Sync, Settings 엔드포인트
  - SSE 스트림 정의
- [quickstart.md](./quickstart.md): 개발 환경 설정 가이드

## Next Steps

1. **`/speckit.tasks`** 실행하여 구현 태스크 생성
2. 태스크 순서대로 구현 진행:
   - P1: 프로젝트 초기화, DB 설정, GitHub OAuth
   - P1: 타임라인 UI, 커밋 동기화
   - P1: AI 요약 기능
   - P2: 실시간 상태 표시
   - P2: 다크모드, 모바일 반응형
3. 각 기능 완료 후 수동 테스트
