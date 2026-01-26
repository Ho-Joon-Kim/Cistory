# Research: Cistory - GitHub Commit Timeline

**Branch**: `001-commit-timeline` | **Date**: 2026-01-26

## 1. Next.js + Cloudflare 배포 전략

### Decision: OpenNext + Cloudflare Workers 사용

**Rationale**:
- Cloudflare는 2025년 12월부터 Next.js 배포 시 **OpenNext with Cloudflare Workers** 사용을 공식 권장
- 기존 `@cloudflare/next-on-pages`는 2025년 9월 archived됨
- OpenNext는 Next.js 14, 15, 16 버전 지원 (Next.js 14 지원은 2026 Q1 종료 예정)
- App Router, SSR, 이미지 최적화 등 대부분의 Next.js 기능 지원

**Alternatives Considered**:
- `@cloudflare/next-on-pages`: Archived, 더 이상 권장되지 않음
- Vercel 배포: Cloudflare D1과의 네이티브 통합 어려움

**Implementation**:
```bash
npm create cloudflare@latest -- my-next-app --framework=next
# 또는 기존 프로젝트에 @opennextjs/cloudflare 추가
```

**References**:
- [Next.js · Cloudflare Workers docs](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [OpenNext Cloudflare](https://opennext.js.org/cloudflare)

---

## 2. Cloudflare D1 데이터베이스

### Decision: Cloudflare D1 + Drizzle ORM 사용

**Rationale**:
- D1은 SQLite 기반 서버리스 데이터베이스
- 최대 10GB 용량, 개인 도구에 충분
- Workers/Pages Functions에서 직접 쿼리 가능
- Time Travel 기능으로 30일 내 복원 가능
- Drizzle ORM은 TypeScript 지원이 우수하고 D1과 잘 통합됨

**Configuration** (`wrangler.jsonc`):
```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cistory-db",
      "database_id": "<database-id>"
    }
  ]
}
```

**Constraints**:
- Worker 크기 제한: Free 3MB, Paid 10MB
- SQLite 제약사항 적용

**References**:
- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/)

---

## 3. GitHub 연동 전략

### Decision: GitHub OAuth App 사용 (NextAuth.js/Auth.js)

**Rationale**:
- 개인 도구이므로 GitHub OAuth App이 적합 (GitHub App은 조직/팀 통합에 더 적합)
- Auth.js(NextAuth.js)가 GitHub OAuth와 Next.js 통합을 잘 지원
- `repo` scope로 private 레포지토리 접근 가능

**Required Scopes**:
- `repo`: 전체 레포지토리 접근 (private 포함)
- `read:user`: 사용자 정보 읽기

**Commit Diff 가져오기**:
```
GET /repos/{owner}/{repo}/commits/{sha}
Accept: application/vnd.github.diff
```
- 300개 이상 파일 변경 시 페이지네이션 적용
- 대용량 diff는 timeout 발생 가능 (5xx)

**Alternatives Considered**:
- GitHub App: 조직 통합에 더 적합, 개인 도구에는 과함
- Personal Access Token: OAuth보다 덜 안전

**References**:
- [Auth.js GitHub Provider](https://authjs.dev/guides/configuring-github)
- [GitHub REST API Commits](https://docs.github.com/en/rest/commits)

---

## 4. AI 요약 (Claude API)

### Decision: Anthropic Claude API + TypeScript SDK 사용 (고급 컨텍스트 수집)

**Rationale**:
- 사용자 요구사항에 명시된 기술 스택
- Claude Sonnet 4가 비용 대비 성능이 우수
- @anthropic-ai/sdk TypeScript SDK 제공

### 4.1 컨텍스트 수집 전략

단순 커밋 diff만으로는 변경의 의도와 맥락을 파악하기 어려움. 다음 단계로 컨텍스트를 수집하여 요약 품질 향상.

**Phase 1: 레포지토리 컨텍스트 수집**
```typescript
interface RepoContext {
  description: string;          // GitHub repo description
  claudeContext?: string;       // CLAUDE.md 파일 내용
  readmeOverview?: string;      // README.md 첫 500자
  techStack?: string[];         // package.json, requirements.txt 등에서 추출
}

// GitHub API로 컨텍스트 파일 가져오기
async function fetchRepoContext(owner: string, repo: string): Promise<RepoContext> {
  const context: RepoContext = { description: '' };

  // 1. CLAUDE.md (프로젝트 AI 컨텍스트)
  try {
    const claudeMd = await github.getContent(owner, repo, 'CLAUDE.md');
    context.claudeContext = claudeMd;
  } catch (e) {
    // 없으면 무시
  }

  // 2. README.md 첫 부분
  try {
    const readme = await github.getContent(owner, repo, 'README.md');
    context.readmeOverview = readme.slice(0, 500);
  } catch (e) {}

  // 3. package.json에서 기술 스택 추출
  try {
    const pkg = await github.getContent(owner, repo, 'package.json');
    const parsed = JSON.parse(pkg);
    context.techStack = Object.keys(parsed.dependencies || {}).slice(0, 10);
  } catch (e) {}

  return context;
}
```

**Phase 2: 최근 커밋 패턴 분석 (선택적)**
```typescript
interface CommitPattern {
  recentCommits: string[];      // 최근 5개 커밋 메시지
  commonPaths: string[];        // 자주 변경되는 경로
  authorPattern?: string;       // 작성자의 커밋 스타일
}

// 연속된 관련 커밋 탐지
async function analyzeRecentCommits(
  owner: string,
  repo: string,
  currentCommit: Commit
): Promise<CommitPattern | null> {
  // 최근 5개 커밋 가져오기
  const recent = await github.getCommits(owner, repo, { per_page: 5 });

  // 같은 파일을 수정한 연속 커밋이 있으면 함께 분석
  const relatedCommits = recent.filter(c =>
    c.files.some(f => currentCommit.files.includes(f))
  );

  if (relatedCommits.length > 1) {
    return {
      recentCommits: relatedCommits.map(c => c.message),
      commonPaths: findCommonPaths(relatedCommits),
    };
  }

  return null;
}
```

### 4.2 고급 프롬프트 설계

```typescript
// 시스템 프롬프트 (레포 컨텍스트 포함)
function buildSystemPrompt(repoContext: RepoContext): string {
  let prompt = `당신은 소프트웨어 개발 변경사항 분석 전문가입니다.`;

  if (repoContext.claudeContext) {
    prompt += `\n\n## 프로젝트 컨텍스트\n${repoContext.claudeContext}`;
  }

  if (repoContext.readmeOverview) {
    prompt += `\n\n## 프로젝트 개요\n${repoContext.readmeOverview}`;
  }

  if (repoContext.techStack?.length) {
    prompt += `\n\n## 기술 스택\n${repoContext.techStack.join(', ')}`;
  }

  return prompt;
}

// 비기술자 요약 (User Prompt)
const nonTechPrompt = `
다음 커밋의 변경 내용을 분석하여, 기술 용어 없이 일반 사용자가 이해할 수 있도록 설명해주세요.

## 요구사항
- "무엇이" 변경되었는지보다 "왜" 변경했는지, "어떤 가치"가 추가되었는지 중심으로 설명
- 사용자 관점에서 체감할 수 있는 변화 위주로 2-3문장 작성
- 기술 용어(API, 리팩토링, 컴포넌트 등) 사용 금지

## 커밋 정보
- 메시지: {commit_message}
- 변경 파일 수: {changed_files_count}개

## 변경 내용 (diff)
{diff_content}

{recent_context}
`;

// 기술자 요약 (User Prompt)
const techPrompt = `
다음 커밋의 변경 내용을 시니어 개발자 관점에서 분석해주세요.

## 분석 항목
1. **변경 의도**: 이 커밋이 해결하려는 문제나 추가하려는 기능
2. **핵심 변경**: 가장 중요한 코드 변경과 그 이유
3. **영향 범위**: 이 변경이 다른 코드에 미칠 수 있는 영향
4. **코드 품질**: 개선점이나 주의할 점 (있다면)

## 커밋 정보
- 메시지: {commit_message}
- 변경 파일: {changed_files}
- 추가: +{additions} / 삭제: -{deletions}

## 변경 내용 (diff)
{diff_content}

{recent_context}

3-5문장으로 핵심만 요약해주세요.
`;

// 최근 커밋 컨텍스트 삽입 (있을 경우)
function buildRecentContext(pattern: CommitPattern | null): string {
  if (!pattern) return '';

  return `
## 관련 최근 커밋 (참고용)
이 커밋과 연관된 최근 작업:
${pattern.recentCommits.map((m, i) => `${i + 1}. ${m}`).join('\n')}

공통 수정 경로: ${pattern.commonPaths.join(', ')}
`;
}
```

### 4.3 요약 생성 서비스

```typescript
// src/modules/summary/service.ts
export async function generateSummary(
  commit: Commit,
  repoInfo: { owner: string; repo: string }
): Promise<{ technical: string; nonTechnical: string }> {

  // 1. 레포지토리 컨텍스트 수집 (캐싱 권장)
  const repoContext = await fetchRepoContext(repoInfo.owner, repoInfo.repo);

  // 2. 최근 커밋 패턴 분석 (선택적 - 성능/비용 트레이드오프)
  const recentPattern = await analyzeRecentCommits(
    repoInfo.owner,
    repoInfo.repo,
    commit
  );

  // 3. diff 가져오기 (토큰 제한 고려하여 truncate)
  const diff = await github.getCommitDiff(repoInfo.owner, repoInfo.repo, commit.sha);
  const truncatedDiff = truncateDiff(diff, 8000); // 약 2000 토큰

  // 4. 프롬프트 구성
  const systemPrompt = buildSystemPrompt(repoContext);
  const recentContext = buildRecentContext(recentPattern);

  // 5. Claude API 호출 (병렬)
  const [technical, nonTechnical] = await Promise.all([
    claude.generateText({
      system: systemPrompt,
      prompt: techPrompt
        .replace('{commit_message}', commit.message)
        .replace('{changed_files}', commit.changedFiles.join(', '))
        .replace('{additions}', String(commit.additions))
        .replace('{deletions}', String(commit.deletions))
        .replace('{diff_content}', truncatedDiff)
        .replace('{recent_context}', recentContext),
    }),
    claude.generateText({
      system: systemPrompt,
      prompt: nonTechPrompt
        .replace('{commit_message}', commit.message)
        .replace('{changed_files_count}', String(commit.changedFilesCount))
        .replace('{diff_content}', truncatedDiff)
        .replace('{recent_context}', recentContext),
    }),
  ]);

  return { technical, nonTechnical };
}
```

### 4.4 비용 최적화

| 전략 | 설명 |
|------|------|
| **RepoContext 캐싱** | CLAUDE.md, README.md는 자주 변경되지 않으므로 24시간 캐싱 |
| **Diff Truncation** | 8000자 이상 diff는 주요 파일만 포함하도록 truncate |
| **배치 처리** | 동기화 시 여러 커밋을 한 번에 처리하되, rate limit 고려 |
| **선택적 최근 커밋 분석** | 복잡한 커밋(파일 5개 이상 변경)에만 적용 |
| **모델 선택** | Claude Sonnet 4 사용 (Opus 대비 비용 효율적) |

### 4.5 구현 태스크 매핑

| 태스크 | 내용 |
|--------|------|
| T048 | Claude adapter 구현 (기본 API 호출) |
| T049 | 프롬프트 정의 (시스템 프롬프트 + 기술자/비기술자) |
| T049-1 (NEW) | RepoContext 수집 로직 구현 |
| T049-2 (NEW) | 최근 커밋 패턴 분석 로직 구현 (선택적) |
| T050 | Summary 서비스 통합 |

**References**:
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [Claude Prompt Engineering Guide](https://docs.anthropic.com/claude/docs/prompt-engineering)

---

## 5. 실시간 상태 업데이트

### Decision: Server-Sent Events (SSE) 사용

**Rationale**:
- 단방향 통신(서버→클라이언트)에 적합
- WebSocket보다 구현이 간단
- Cloudflare Workers에서 지원

**Implementation Pattern**:
```typescript
// API Route (Next.js)
export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ status: 'fetching', message: '깃허브에서 커밋 히스토리 가져오는 중...' });
      // ... 작업 수행
      send({ status: 'summarizing', progress: '3/5', message: 'AI 요약 생성 중...' });
      // ...
      controller.close();
    }
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}
```

**Alternatives Considered**:
- WebSocket: 양방향 필요 없음, 과함
- Polling: 비효율적

---

## 6. UI 컴포넌트 라이브러리

### Decision: shadcn/ui 사용

**Rationale**:
- 사용자 요구사항에 명시
- Radix UI 기반, 접근성 우수
- Tailwind CSS 통합
- 다크모드 지원 내장

**Key Components Needed**:
- Card: 커밋 카드
- Timeline/Stepper: 수직 타임라인 (커스텀 구현 필요)
- Toggle: 기술자/비기술자 뷰 전환
- Button, Input, Select: 필터링
- Toast: 알림

---

## 7. 프로젝트 구조 (모듈화/추상화 원칙)

### Decision: Feature-based Module Architecture

**Rationale**:
- NFR-001~005 충족 (모듈화, 추상화, 확장성)
- 각 기능이 독립적으로 개발/테스트 가능

**Structure**:
```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/            # 인증 관련 라우트
│   ├── (dashboard)/       # 메인 대시보드
│   └── api/               # API Routes
├── modules/
│   ├── auth/              # GitHub OAuth 모듈
│   ├── github/            # GitHub API 연동 (추상화 계층)
│   ├── sync/              # 동기화 로직
│   ├── summary/           # AI 요약 (추상화 계층)
│   └── timeline/          # 타임라인 UI
├── lib/
│   ├── adapters/          # 외부 서비스 어댑터
│   │   ├── vcs/           # VCS 인터페이스 (GitHubAdapter)
│   │   ├── ai/            # AI 인터페이스 (ClaudeAdapter)
│   │   └── db/            # DB 인터페이스 (D1Adapter)
│   └── interfaces/        # 공통 인터페이스 정의
├── components/            # 공용 UI 컴포넌트
└── db/
    ├── schema.ts          # Drizzle 스키마
    └── migrations/        # 마이그레이션
```

---

## 8. 인증 전략

### Decision: Better Auth 또는 Auth.js 사용

**Rationale**:
- GitHub OAuth 통합 지원
- Cloudflare Workers/D1과 호환
- 세션 관리 내장

**Better Auth 장점**:
- Cloudflare Workers에 최적화
- D1 어댑터 제공

**Auth.js 장점**:
- 더 넓은 커뮤니티
- 다양한 provider 지원

**Final Decision**: Better Auth (Cloudflare 환경 최적화)

---

## Summary

| 영역 | 결정 | 근거 |
|------|------|------|
| 배포 | OpenNext + Cloudflare Workers | 공식 권장, next-on-pages deprecated |
| 데이터베이스 | Cloudflare D1 + Drizzle ORM | 사용자 요구사항, 서버리스 |
| GitHub 연동 | OAuth App + Auth.js/Better Auth | 개인 도구, 간단한 설정 |
| AI 요약 | Claude API + TypeScript SDK | 사용자 요구사항 |
| 실시간 업데이트 | Server-Sent Events | 단방향, 간단 |
| UI | shadcn/ui + Tailwind | 사용자 요구사항, 다크모드 |
| 프로젝트 구조 | Feature-based Modules | NFR 충족 |
