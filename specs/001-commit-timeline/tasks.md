# Tasks: Cistory - GitHub Commit Timeline

**Input**: Design documents from `/specs/001-commit-timeline/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.yaml

**Tests**: 자동화 테스트 제외 (spec.md에 명시). 수동 테스트만 진행.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create Next.js project with Cloudflare template: `npm create cloudflare@latest -- cistory --framework=next`
- [x] T002 Configure yarn and install core dependencies in package.json
- [x] T003 [P] Configure wrangler.jsonc with D1 database binding
- [x] T004 [P] Configure tailwind.config.ts with dark mode support
- [x] T005 [P] Initialize shadcn/ui with components.json
- [x] T006 [P] Create open-next.config.ts for OpenNext adapter
- [x] T007 [P] Configure drizzle.config.ts for D1 migrations
- [x] T008 Create base project structure: src/app/, src/modules/, src/lib/, src/components/, src/db/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T009 Create Drizzle schema for all entities in src/db/schema.ts (User, Repository, Commit, CommitSummary, SyncJob)
- [x] T010 Create D1 database client in src/db/index.ts
- [x] T011 Generate and apply initial migration: `yarn drizzle-kit generate && wrangler d1 execute`
- [x] T012 [P] Define VCS interface in src/lib/adapters/vcs/interface.ts
- [x] T013 [P] Define AI interface in src/lib/adapters/ai/interface.ts
- [x] T014 [P] Create utility functions in src/lib/utils.ts (uuid, timestamp, etc.)
- [x] T015 [P] Install shadcn/ui base components: button, card, input, select, toggle, toast
- [x] T016 Create root layout with providers in src/app/layout.tsx
- [x] T017 Create global styles in src/app/globals.css

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - GitHub 계정 연동 및 레포지토리 선택 (Priority: P1) 🎯 MVP

**Goal**: 사용자가 GitHub 계정을 연동하고 추적할 레포지토리를 선택할 수 있다

**Independent Test**: GitHub 로그인 → 레포지토리 목록 확인 → 레포지토리 선택 → 커밋 동기화 시작 확인

### Implementation for User Story 1

#### Auth Module
- [x] T018 [US1] Configure Better Auth with GitHub provider in src/lib/auth.ts
- [x] T019 [US1] Create auth API route handler in src/app/api/auth/[...path]/route.ts
- [x] T020 [P] [US1] Create login page in src/app/(auth)/login/page.tsx
- [x] T021 [P] [US1] Create OAuth callback handler in src/app/(auth)/callback/page.tsx
- [x] T022 [US1] Create auth hooks in src/modules/auth/hooks.ts (useUser, useAuth)
- [x] T023 [P] [US1] Create LoginButton component in src/modules/auth/components/LoginButton.tsx
- [x] T024 [P] [US1] Create UserMenu component in src/modules/auth/components/UserMenu.tsx

#### GitHub Adapter
- [x] T025 [US1] Implement GitHub adapter in src/lib/adapters/vcs/github.ts (getRepositories, getCommits, getCommitDiff)
- [x] T026 [US1] Create GitHub types in src/modules/github/types.ts
- [x] T027 [US1] Create GitHub service in src/modules/github/service.ts

#### Repository Management
- [x] T028 [US1] Create repositories API route (GET list) in src/app/api/repositories/route.ts
- [x] T029 [US1] Create tracked repositories API route in src/app/api/repositories/tracked/route.ts
- [x] T030 [US1] Create track/untrack API route in src/app/api/repositories/[repoId]/track/route.ts
- [x] T031 [US1] Create repositories page in src/app/(dashboard)/repositories/page.tsx
- [x] T032 [P] [US1] Create RepositoryList component in src/modules/github/components/RepositoryList.tsx
- [x] T033 [P] [US1] Create RepositoryCard component in src/modules/github/components/RepositoryCard.tsx

#### Initial Sync (Basic)
- [x] T034 [US1] Create basic sync service in src/modules/sync/service.ts (fetchCommits, saveCommits)
- [x] T035 [US1] Trigger initial sync when repository is tracked

#### Auth Disconnect
- [x] T036 [US1] Create disconnect API route in src/app/api/auth/disconnect/route.ts
- [x] T037 [US1] Implement cascade delete for user data

**Checkpoint**: User Story 1 완료 - GitHub 연동, 레포지토리 선택, 기본 커밋 동기화 동작

---

## Phase 4: User Story 2 - 커밋 타임라인 조회 (Priority: P1)

**Goal**: 모든 추적 레포지토리의 커밋을 통합 타임라인으로 조회할 수 있다

**Independent Test**: 타임라인 페이지 접근 → 커밋 목록 표시 → 스크롤/페이지네이션 → 필터링

### Implementation for User Story 2

#### Timeline API
- [x] T038 [US2] Create timeline API route (GET with pagination, filters) in src/app/api/timeline/route.ts
- [x] T039 [US2] Create commit detail API route in src/app/api/timeline/commits/[commitId]/route.ts

#### Timeline UI Components
- [x] T040 [US2] Create Timeline component in src/modules/timeline/components/Timeline.tsx
- [x] T041 [P] [US2] Create CommitCard component in src/modules/timeline/components/CommitCard.tsx
- [x] T042 [P] [US2] Create TimelineSkeleton component in src/modules/timeline/components/TimelineSkeleton.tsx
- [x] T043 [US2] Create Filters component (repo, date range) in src/modules/timeline/components/Filters.tsx
- [x] T044 [US2] Create timeline hooks in src/modules/timeline/hooks.ts (useTimeline, useFilters)

#### Dashboard Page
- [x] T045 [US2] Create main dashboard/timeline page in src/app/(dashboard)/page.tsx
- [x] T046 [US2] Implement infinite scroll or pagination in Timeline component
- [x] T047 [US2] Add empty state when no commits

**Checkpoint**: User Story 2 완료 - 통합 타임라인 조회, 필터링 동작

---

## Phase 5: User Story 3 - AI 요약 조회 (Priority: P1)

**Goal**: 각 커밋에 대해 기술자/비기술자 관점의 AI 요약을 조회할 수 있다

**Independent Test**: 커밋 카드 확장 → 요약 표시 → 기술자/비기술자 토글 → 요약 재생성

### Implementation for User Story 3

#### Claude Adapter
- [x] T048 [US3] Implement Claude adapter in src/lib/adapters/ai/claude.ts

#### Context & Prompts
- [x] T049 [US3] Create AI prompts in src/modules/summary/prompts.ts (system, technical, nonTechnical)
- [x] T049-1 [US3] Implement RepoContext fetcher in src/modules/summary/context.ts (CLAUDE.md, README.md, tech stack extraction)
- [x] T049-2 [P] [US3] Implement recent commits pattern analyzer in src/modules/summary/context.ts (optional, for complex commits)

#### Summary Service
- [x] T050 [US3] Create summary service in src/modules/summary/service.ts (generateSummary with context integration)
- [x] T051 [US3] Implement summary generation during sync in src/modules/sync/service.ts

#### Summary API
- [x] T052 [US3] Create summary regeneration API route in src/app/api/timeline/commits/[commitId]/summary/route.ts

#### Summary UI
- [x] T053 [US3] Update CommitCard to show summary with toggle in src/modules/timeline/components/CommitCard.tsx
- [x] T054 [P] [US3] Create SummaryView component in src/modules/summary/components/SummaryView.tsx
- [x] T055 [P] [US3] Create SummaryToggle component in src/modules/summary/components/SummaryToggle.tsx
- [x] T056 [US3] Add loading/error states for summary generation

**Checkpoint**: User Story 3 완료 - AI 요약 생성 및 조회, 기술자/비기술자 토글 동작

---

## Phase 6: User Story 4 - 실시간 동기화 및 상태 표시 (Priority: P2)

**Goal**: 동기화 진행 상태를 실시간으로 표시하고 주기적 자동 동기화를 수행한다

**Independent Test**: 수동 동기화 버튼 → 상태 표시 → 완료 후 타임라인 업데이트

### Implementation for User Story 4

#### Sync API with SSE
- [x] T057 [US4] Create sync trigger API route in src/app/api/sync/route.ts
- [x] T058 [US4] Create SSE status endpoint in src/app/api/sync/status/route.ts
- [x] T059 [US4] Create sync jobs history API in src/app/api/sync/jobs/route.ts

#### Enhanced Sync Service
- [x] T060 [US4] Enhance sync service with progress tracking in src/modules/sync/service.ts
- [x] T061 [US4] Implement scheduled sync logic (cron or interval)

#### Sync UI
- [x] T062 [US4] Create SyncButton component in src/modules/sync/components/SyncButton.tsx
- [x] T063 [P] [US4] Create SyncStatus component in src/modules/sync/components/SyncStatus.tsx
- [x] T064 [US4] Create useSyncStatus hook with SSE in src/modules/sync/hooks.ts
- [x] T065 [US4] Add sync status indicator to dashboard header

**Checkpoint**: User Story 4 완료 - 실시간 동기화 상태 표시, 수동/자동 동기화 동작

---

## Phase 7: User Story 5 - 다크모드 및 모바일 반응형 (Priority: P2)

**Goal**: 다크모드를 지원하고 모바일에서 최적화된 UI를 제공한다

**Independent Test**: 테마 토글 → 다크모드 전환 → 모바일 화면에서 타임라인 확인

### Implementation for User Story 5

#### Theme System
- [x] T066 [US5] Create ThemeProvider in src/components/ThemeProvider.tsx
- [x] T067 [P] [US5] Create ThemeToggle component in src/components/ThemeToggle.tsx
- [x] T068 [US5] Add theme persistence to user settings

#### Settings
- [x] T069 [US5] Create settings API route in src/app/api/settings/route.ts
- [x] T070 [US5] Create settings page in src/app/(dashboard)/settings/page.tsx
- [x] T071 [P] [US5] Create SettingsForm component in src/modules/settings/components/SettingsForm.tsx

#### Responsive Design
- [x] T072 [US5] Add responsive styles to Timeline component
- [x] T073 [US5] Add responsive styles to CommitCard component
- [x] T074 [US5] Add responsive styles to Filters component
- [x] T075 [US5] Create mobile navigation/menu

#### Layout
- [x] T076 [US5] Create Header component with theme toggle in src/components/Layout/Header.tsx
- [x] T077 [US5] Create responsive sidebar/nav in src/components/Layout/MobileNav.tsx
- [x] T078 [US5] Update root layout with Header and responsive structure

**Checkpoint**: User Story 5 완료 - 다크모드, 모바일 반응형 UI 동작

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T079 Add error boundary and global error handling
- [x] T080 [P] Add loading states across all pages
- [x] T081 [P] Add toast notifications for user actions
- [x] T082 Implement edge cases handling (deleted repo, API rate limit, etc.)
- [x] T083 [P] Add meta tags and SEO basics
- [x] T084 Performance optimization (caching, lazy loading)
- [x] T085 Final UI polish and consistency check
- [x] T086 Run quickstart.md validation and deployment test

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1: Setup
    ↓
Phase 2: Foundational (BLOCKS all user stories)
    ↓
    ├── Phase 3: US1 - GitHub 연동 (P1) 🎯 MVP
    │       ↓
    ├── Phase 4: US2 - 타임라인 조회 (P1) [depends on US1 for data]
    │       ↓
    ├── Phase 5: US3 - AI 요약 (P1) [depends on US1, US2]
    │       ↓
    ├── Phase 6: US4 - 실시간 동기화 (P2)
    │       ↓
    └── Phase 7: US5 - 다크모드/모바일 (P2)
            ↓
        Phase 8: Polish
```

### User Story Dependencies

| Story | Depends On | Can Start After |
|-------|------------|-----------------|
| US1 | Foundational | Phase 2 완료 |
| US2 | US1 (커밋 데이터 필요) | US1 T035 완료 |
| US3 | US1, US2 | US2 완료 |
| US4 | US1 | US1 완료 |
| US5 | None (UI only) | Phase 2 완료 |

### Parallel Opportunities

**Phase 1-2 (Setup/Foundational)**:
- T003, T004, T005, T006, T007 can run in parallel
- T012, T013, T014, T015 can run in parallel

**Within User Stories**:
- US1: T020/T021, T023/T024, T032/T033 can run in parallel
- US2: T041/T042 can run in parallel
- US3: T054/T055 can run in parallel
- US5: T067/T071, T072/T073/T074 can run in parallel

---

## Parallel Example: User Story 1

```bash
# After T019 (auth route) is complete, launch in parallel:
Task: T020 - Create login page
Task: T021 - Create callback handler

# After T022 (hooks) is complete, launch in parallel:
Task: T023 - Create LoginButton component
Task: T024 - Create UserMenu component

# After T030 (track API) is complete, launch in parallel:
Task: T032 - Create RepositoryList component
Task: T033 - Create RepositoryCard component
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: GitHub 로그인, 레포 선택, 기본 커밋 동기화 테스트
5. Deploy/demo if ready

### Incremental Delivery (Recommended)

1. Setup + Foundational → Foundation ready
2. **US1 완료** → GitHub 연동 가능 (MVP!)
3. **US2 완료** → 타임라인 조회 가능
4. **US3 완료** → AI 요약 조회 가능 (핵심 가치!)
5. **US4 완료** → 실시간 상태 표시
6. **US5 완료** → 다크모드/모바일 지원
7. Polish → 최종 배포

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| Phase 1: Setup | T001-T008 (8) | 프로젝트 초기화 |
| Phase 2: Foundational | T009-T017 (9) | DB, 어댑터 인터페이스, 기본 UI |
| Phase 3: US1 | T018-T037 (20) | GitHub OAuth, 레포지토리 관리 |
| Phase 4: US2 | T038-T047 (10) | 타임라인 UI, 필터링 |
| Phase 5: US3 | T048-T056 (11) | AI 요약, Claude 연동, 컨텍스트 수집 |
| Phase 6: US4 | T057-T065 (9) | SSE, 실시간 상태 |
| Phase 7: US5 | T066-T078 (13) | 테마, 반응형, 설정 |
| Phase 8: Polish | T079-T086 (8) | 마무리 |
| **Total** | **88 tasks** | |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- 자동화 테스트 제외 - 각 User Story 완료 후 수동 테스트로 검증
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
