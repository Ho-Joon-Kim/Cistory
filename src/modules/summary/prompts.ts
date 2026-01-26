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

/**
 * 시스템 프롬프트 빌더
 * 레포지토리 컨텍스트를 기반으로 시스템 프롬프트 생성
 */
export function buildSystemPrompt(repoContext: RepoContext): string {
  let prompt = `당신은 소프트웨어 개발 변경사항 분석 전문가입니다.
주어진 커밋의 변경 내용을 분석하여 명확하고 간결한 요약을 제공합니다.`;

  if (repoContext.claudeContext) {
    prompt += `

## 프로젝트 AI 컨텍스트
다음은 이 프로젝트의 CLAUDE.md 파일 내용입니다. 프로젝트의 특성과 컨벤션을 이해하는 데 참고하세요:

${repoContext.claudeContext}`;
  }

  if (repoContext.readmeOverview) {
    prompt += `

## 프로젝트 개요
${repoContext.readmeOverview}`;
  }

  if (repoContext.techStack && repoContext.techStack.length > 0) {
    prompt += `

## 기술 스택
이 프로젝트는 다음 기술을 사용합니다: ${repoContext.techStack.join(", ")}`;
  }

  if (repoContext.description) {
    prompt += `

## 레포지토리 설명
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

/**
 * 비기술자용 요약 프롬프트
 */
export function buildNonTechnicalPrompt(
  commit: CommitContext,
  recentContext: string
): string {
  return `다음 커밋의 변경 내용을 분석하여, 기술 용어 없이 일반 사용자가 이해할 수 있도록 설명해주세요.

## 요구사항
- "무엇이" 변경되었는지보다 "왜" 변경했는지, "어떤 가치"가 추가되었는지 중심으로 설명
- 사용자 관점에서 체감할 수 있는 변화 위주로 설명
- 2-3문장으로 간결하게 작성
- 기술 용어(API, 리팩토링, 컴포넌트, 모듈 등) 사용 금지
- 한국어로 작성

## 커밋 정보
- 메시지: ${commit.message}
- 변경 파일 수: ${commit.changedFiles.length}개

## 변경 내용 (diff)
${commit.diff}
${recentContext}`;
}

/**
 * 기술자용 요약 프롬프트
 */
export function buildTechnicalPrompt(
  commit: CommitContext,
  recentContext: string
): string {
  return `다음 커밋의 변경 내용을 시니어 개발자 관점에서 분석해주세요.

## 분석 항목
1. **변경 의도**: 이 커밋이 해결하려는 문제나 추가하려는 기능
2. **핵심 변경**: 가장 중요한 코드 변경과 그 이유
3. **영향 범위**: 이 변경이 다른 코드에 미칠 수 있는 영향
4. **주의점**: 개선점이나 주의할 점 (있다면)

## 커밋 정보
- 메시지: ${commit.message}
- 변경 파일: ${commit.changedFiles.join(", ")}
- 추가: +${commit.additions} / 삭제: -${commit.deletions}

## 변경 내용 (diff)
${commit.diff}
${recentContext}

## 출력 형식
3-5문장으로 핵심만 요약해주세요. 한국어로 작성합니다.`;
}

/**
 * 프롬프트 템플릿 (간단 버전 - 컨텍스트 없이)
 */
export const SIMPLE_SYSTEM_PROMPT = `당신은 소프트웨어 개발 변경사항을 분석하는 전문가입니다.
커밋 내용을 분석하여 명확하고 간결한 요약을 제공합니다.`;

export const SIMPLE_NON_TECHNICAL_TEMPLATE = `다음 커밋의 변경 내용을 기술 용어 없이 설명해주세요.

커밋 메시지: {message}
변경된 파일 수: {fileCount}개

2-3문장으로 "어떤 기능이 추가/수정되었는지" 설명해주세요.
한국어로 작성하고, API, 컴포넌트 같은 기술 용어는 피해주세요.`;

export const SIMPLE_TECHNICAL_TEMPLATE = `다음 커밋의 변경 내용을 분석해주세요.

커밋 메시지: {message}
변경된 파일: {files}
추가: +{additions} / 삭제: -{deletions}

3-5문장으로 변경 의도, 핵심 변경, 영향 범위를 설명해주세요.
한국어로 작성합니다.`;
