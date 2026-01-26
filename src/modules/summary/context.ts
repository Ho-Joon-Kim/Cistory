/**
 * Summary Context Fetcher
 *
 * 레포지토리 컨텍스트 및 최근 커밋 패턴 분석
 */

import type { VCSAdapter } from "@/lib/adapters/vcs/interface";
import type { RepoContext, RecentCommitPattern } from "./prompts";

// 캐시 (메모리 - 프로덕션에서는 KV 사용 권장)
const contextCache = new Map<string, { context: RepoContext; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

/**
 * 레포지토리 컨텍스트 수집
 * CLAUDE.md, README.md, package.json 등에서 정보 추출
 */
export async function fetchRepoContext(
  vcsAdapter: VCSAdapter,
  owner: string,
  repo: string,
  description: string = ""
): Promise<RepoContext> {
  const cacheKey = `${owner}/${repo}`;
  const cached = contextCache.get(cacheKey);

  // 캐시 확인
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.context;
  }

  const context: RepoContext = {
    description,
  };

  // 1. CLAUDE.md (프로젝트 AI 컨텍스트)
  try {
    const claudeMd = await vcsAdapter.getFileContent(owner, repo, "CLAUDE.md");
    if (claudeMd) {
      // 토큰 절약을 위해 최대 2000자로 제한
      context.claudeContext = claudeMd.content.slice(0, 2000);
    }
  } catch {
    // 파일이 없으면 무시
  }

  // 2. README.md 첫 부분
  try {
    const readme = await vcsAdapter.getFileContent(owner, repo, "README.md");
    if (readme) {
      context.readmeOverview = readme.content.slice(0, 500);
    }
  } catch {
    // 파일이 없으면 무시
  }

  // 3. package.json에서 기술 스택 추출
  try {
    const pkg = await vcsAdapter.getFileContent(owner, repo, "package.json");
    if (pkg) {
      const parsed = JSON.parse(pkg.content);
      const deps = Object.keys(parsed.dependencies || {});
      const devDeps = Object.keys(parsed.devDependencies || {});

      // 주요 의존성만 추출 (최대 10개)
      const mainDeps = [...deps, ...devDeps]
        .filter(isImportantDependency)
        .slice(0, 10);

      if (mainDeps.length > 0) {
        context.techStack = mainDeps;
      }
    }
  } catch {
    // 파일이 없거나 파싱 실패 시 무시
  }

  // 4. requirements.txt (Python 프로젝트)
  if (!context.techStack || context.techStack.length === 0) {
    try {
      const requirements = await vcsAdapter.getFileContent(
        owner,
        repo,
        "requirements.txt"
      );
      if (requirements) {
        const deps = requirements.content
          .split("\n")
          .map((line) => line.split("==")[0].split(">=")[0].trim())
          .filter((dep) => dep && !dep.startsWith("#"))
          .slice(0, 10);

        if (deps.length > 0) {
          context.techStack = deps;
        }
      }
    } catch {
      // 무시
    }
  }

  // 캐시 저장
  contextCache.set(cacheKey, { context, timestamp: Date.now() });

  return context;
}

/**
 * 최근 커밋 패턴 분석
 * 현재 커밋과 관련된 최근 커밋들 분석
 */
export async function analyzeRecentCommits(
  vcsAdapter: VCSAdapter,
  owner: string,
  repo: string,
  currentCommitFiles: string[],
  excludeSha: string
): Promise<RecentCommitPattern | null> {
  try {
    // 최근 10개 커밋 가져오기
    const recentCommits = await vcsAdapter.getCommits(owner, repo, {
      perPage: 10,
    });

    // 현재 커밋 제외
    const otherCommits = recentCommits.filter((c) => c.sha !== excludeSha);

    if (otherCommits.length === 0) {
      return null;
    }

    // 파일 기반 관련성 분석은 복잡하므로 단순히 최근 커밋 메시지만 반환
    // (파일 정보가 없는 경우가 많음)
    const relatedMessages = otherCommits.slice(0, 5).map((c) => {
      // 메시지 첫 줄만, 최대 100자
      const firstLine = c.message.split("\n")[0];
      return firstLine.length > 100 ? firstLine.slice(0, 97) + "..." : firstLine;
    });

    // 공통 디렉토리 추출
    const directories = currentCommitFiles
      .map((f) => f.split("/").slice(0, -1).join("/"))
      .filter(Boolean);

    const uniqueDirs = [...new Set(directories)].slice(0, 3);

    return {
      recentCommits: relatedMessages,
      commonPaths: uniqueDirs.length > 0 ? uniqueDirs : ["(루트)"],
    };
  } catch {
    return null;
  }
}

/**
 * 중요한 의존성인지 판단
 */
function isImportantDependency(dep: string): boolean {
  // 내부 도구나 타입 정의는 제외
  if (dep.startsWith("@types/")) return false;
  if (dep.startsWith("eslint")) return false;
  if (dep.startsWith("prettier")) return false;

  // 주요 프레임워크/라이브러리
  const important = [
    "react",
    "next",
    "vue",
    "angular",
    "svelte",
    "express",
    "fastify",
    "nest",
    "drizzle",
    "prisma",
    "tailwind",
    "typescript",
    "graphql",
    "trpc",
    "zustand",
    "redux",
    "tanstack",
    "axios",
    "zod",
    "better-auth",
    "anthropic",
    "openai",
  ];

  return important.some((i) => dep.toLowerCase().includes(i));
}

/**
 * 캐시 초기화 (테스트용)
 */
export function clearContextCache(): void {
  contextCache.clear();
}
