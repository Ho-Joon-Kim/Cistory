/**
 * AI Summary Prompts
 *
 * 고급 컨텍스트 수집 전략을 활용한 프롬프트 설계
 */

export interface RepoContext {
  description: string;
  claudeContext?: string; // CLAUDE.md 내용
  readmeOverview?: string; // README.md 첫 500자
  techStack?: string[]; // package.json 등에서 추출한 기술 스택
}

export interface CommitContext {
  message: string;
  changedFiles: string[];
  additions: number;
  deletions: number;
  diff: string;
}

export interface RecentCommitPattern {
  recentCommits: string[]; // 최근 커밋 메시지들
  commonPaths: string[]; // 공통으로 수정된 경로
}

// ============ 커밋 유형 분류 ============

export type CommitType =
  | "feat"      // 새 기능
  | "fix"       // 버그 수정
  | "refactor"  // 리팩토링
  | "style"     // 스타일/UI 변경
  | "docs"      // 문서
  | "test"      // 테스트
  | "chore"     // 빌드/설정
  | "perf"      // 성능 개선
  | "unknown";  // 분류 불가

/**
 * 커밋 메시지에서 유형 추출 (Conventional Commits 패턴)
 */
export function detectCommitType(message: string): CommitType {
  const lowerMessage = message.toLowerCase();
  const firstLine = lowerMessage.split("\n")[0];

  // Conventional Commits 패턴: type(scope): message
  const conventionalMatch = firstLine.match(/^(feat|fix|refactor|style|docs|test|chore|perf)(\(.+\))?:/);
  if (conventionalMatch) {
    return conventionalMatch[1] as CommitType;
  }

  // 키워드 기반 추론
  if (/^(add|implement|새로운|추가|기능)/.test(firstLine)) return "feat";
  if (/^(fix|버그|수정|해결|bugfix)/.test(firstLine)) return "fix";
  if (/^(refactor|리팩토링|리팩터|개선|정리)/.test(firstLine)) return "refactor";
  if (/^(style|ui|css|디자인|스타일)/.test(firstLine)) return "style";
  if (/^(doc|문서|readme)/.test(firstLine)) return "docs";
  if (/^(test|테스트|spec)/.test(firstLine)) return "test";
  if (/^(chore|build|ci|설정|config)/.test(firstLine)) return "chore";
  if (/^(perf|성능|최적화|optimize)/.test(firstLine)) return "perf";

  return "unknown";
}

/**
 * 변경된 파일 경로에서 영역 추론
 */
export function detectChangeArea(files: string[]): string {
  if (files.length === 0) return "일반";

  const areas: string[] = [];

  // 경로 패턴 분석
  const hasApi = files.some(f => f.includes("/api/") || f.includes("route.ts"));
  const hasComponents = files.some(f => f.includes("/components/") || f.includes(".tsx"));
  const hasStyles = files.some(f => f.includes(".css") || f.includes("tailwind") || f.includes("styles"));
  const hasDb = files.some(f => f.includes("/db/") || f.includes("schema") || f.includes("drizzle"));
  const hasAuth = files.some(f => f.includes("auth") || f.includes("login") || f.includes("session"));
  const hasConfig = files.some(f => f.includes("config") || f.includes(".json") || f.includes(".env"));
  const hasDocs = files.some(f => f.includes(".md") || f.includes("docs/"));
  const hasTests = files.some(f => f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__"));

  if (hasAuth) areas.push("로그인/인증");
  if (hasApi) areas.push("서버");
  if (hasDb) areas.push("데이터베이스");
  if (hasComponents) areas.push("화면");
  if (hasStyles) areas.push("디자인");
  if (hasConfig) areas.push("설정");
  if (hasDocs) areas.push("문서");
  if (hasTests) areas.push("테스트");

  return areas.length > 0 ? areas.slice(0, 2).join("/") : "일반";
}

/**
 * 시스템 프롬프트 빌더
 * 레포지토리 컨텍스트를 기반으로 시스템 프롬프트 생성
 */
export function buildSystemPrompt(repoContext: RepoContext): string {
  let prompt = `당신은 개발 변경사항을 비개발자에게 번역하는 전문가입니다.

## 핵심 원칙
1. **사용자 관점**: "개발자가 뭘 했는지"가 아닌 "사용자에게 뭐가 달라졌는지"
2. **한 문장**: 50자 이내의 명확한 한 문장
3. **기술 용어 금지**: API, 컴포넌트, 리팩토링, 스키마, 마이그레이션 등 절대 사용 금지
4. **구체적 표현**: "버그 수정" → "로그인 시 비밀번호 오류 메시지가 안 보이던 문제 해결"`;

  if (repoContext.claudeContext) {
    prompt += `

## 이 프로젝트 정보
${repoContext.claudeContext.slice(0, 1000)}`;
  }

  if (repoContext.readmeOverview) {
    prompt += `

## 프로젝트 개요
${repoContext.readmeOverview}`;
  }

  if (repoContext.description) {
    prompt += `

## 프로젝트 설명
${repoContext.description}`;
  }

  return prompt;
}

/**
 * 최근 커밋 컨텍스트 빌더
 */
export function buildRecentContext(pattern: RecentCommitPattern | null): string {
  if (!pattern || pattern.recentCommits.length === 0) return "";

  return `
## 관련 최근 커밋 (참고용)
이 커밋과 연관된 최근 작업입니다. 맥락을 이해하는 데 참고하세요:
${pattern.recentCommits.map((m, i) => `${i + 1}. ${m}`).join("\n")}

공통 수정 경로: ${pattern.commonPaths.join(", ")}`;
}

// ============ 커밋 유형별 문장 패턴 ============

const COMMIT_TYPE_PATTERNS: Record<CommitType, string> = {
  feat: "~을(를) 할 수 있게 되었습니다",
  fix: "~하던 문제가 해결되었습니다",
  refactor: "내부 동작 방식이 개선되었습니다 (사용 방법 변화 없음)",
  style: "화면 디자인이 변경되었습니다",
  docs: "설명 문서가 업데이트되었습니다",
  test: "품질 검증 과정이 추가되었습니다",
  chore: "개발 환경이 개선되었습니다",
  perf: "더 빠르게 동작하도록 개선되었습니다",
  unknown: "변경사항이 적용되었습니다",
};

/**
 * 요약 프롬프트 (개선된 버전)
 */
export function buildSummaryPrompt(
  commit: CommitContext,
  recentContext: string
): string {
  const commitType = detectCommitType(commit.message);
  const changeArea = detectChangeArea(commit.changedFiles);
  const patternHint = COMMIT_TYPE_PATTERNS[commitType];

  return `당신은 개발 변경사항을 비개발자에게 설명하는 전문가입니다.

## 이 커밋의 분석 결과
- 변경 유형: ${commitType} (${getCommitTypeLabel(commitType)})
- 변경 영역: ${changeArea}
- 권장 문장 패턴: "${patternHint}"

## 요약 작성 규칙

### 필수
1. **한 문장**으로 핵심만 작성 (최대 50자)
2. 기술 용어 절대 금지 (API, 컴포넌트, 리팩토링, 모듈, 스키마 등)
3. **사용자 관점**에서 "무엇이 달라졌는지" 설명
4. 한국어로 작성

### 유형별 가이드
- **feat(기능)**: "~을 할 수 있게 되었습니다" 패턴 사용
- **fix(버그)**: "~하던 문제가 해결되었습니다" 패턴 사용
- **refactor/chore/perf**: "내부 개선 (사용자 영향 없음)" 간단히 처리
- **style**: "~의 디자인이 변경되었습니다" 패턴 사용

### 금지 표현
- "~를 추가했습니다" (개발자 시점)
- "~를 수정했습니다" (모호함)
- "버그 수정" (무슨 버그인지 불명확)

## 커밋 정보
- 메시지: ${commit.message}
- 변경 영역: ${changeArea}
- 변경 파일 수: ${commit.changedFiles.length}개

## 변경 내용 (diff)
${commit.diff}
${recentContext}

## 출력 형식
한 문장만 출력하세요. 다른 설명 없이 요약문만 작성합니다.`;
}

/**
 * 커밋 유형 라벨
 */
function getCommitTypeLabel(type: CommitType): string {
  const labels: Record<CommitType, string> = {
    feat: "새 기능",
    fix: "버그 수정",
    refactor: "코드 정리",
    style: "디자인 변경",
    docs: "문서 수정",
    test: "테스트 추가",
    chore: "환경 설정",
    perf: "성능 개선",
    unknown: "기타 변경",
  };
  return labels[type];
}

/**
 * 프롬프트 템플릿 (간단 버전 - 컨텍스트 없이)
 */
export const SIMPLE_SYSTEM_PROMPT = `당신은 소프트웨어 개발 변경사항을 비개발자에게 설명하는 전문가입니다.
기술 용어 없이 사용자 관점에서 변경사항을 한 문장으로 요약합니다.`;

export const SIMPLE_SUMMARY_TEMPLATE = `커밋 메시지: {message}
변경된 파일 수: {fileCount}개

한 문장(최대 50자)으로 "사용자에게 무엇이 달라졌는지" 설명하세요.
기술 용어(API, 컴포넌트 등) 사용 금지. 한국어로 작성.`;
