import { logger } from "@/lib/logger";

const GITHUB_API_BASE = "https://api.github.com";

// ── Types (previously in ./interface.ts) ─────────────────────────────────────

export interface VCSRepository {
  id: number;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

export interface VCSCommit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string | null;
  authorAvatarUrl: string | null;
  committedAt: string;
  additions: number;
  deletions: number;
  changedFilesCount: number;
  isMergeCommit: boolean;
  parentShas: string[];
}

export interface VCSFileDiff {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
}

export interface VCSCommitDiff {
  sha: string;
  files: VCSFileDiff[];
  rawDiff: string;
}

export interface VCSFileContent {
  path: string;
  content: string;
  encoding: string;
}

export interface GetCommitsOptions {
  since?: string;
  until?: string;
  perPage?: number;
  page?: number;
  sha?: string;
}

export interface GetRepositoriesOptions {
  perPage?: number;
  page?: number;
  sort?: "created" | "updated" | "pushed" | "full_name";
  direction?: "asc" | "desc";
}

export interface SearchCommitsOptions {
  since?: string;
  until?: string;
  perPage?: number;
  page?: number;
}

export interface VCSSearchCommit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string | null;
  authorAvatarUrl: string | null;
  committedAt: string;
  repoFullName: string;
  repoId: number;
  repoIsPrivate: boolean;
  additions?: number;
  deletions?: number;
  changedFilesCount?: number;
  isMergeCommit: boolean;
  parentShas: string[];
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export class GitHubAdapter {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}, accept?: string): Promise<T> {
    const url = endpoint.startsWith("http") ? endpoint : `${GITHUB_API_BASE}${endpoint}`;
    const isDiff = accept === "application/vnd.github.diff";
    // diff payloads can be megabytes for large commits; give them a longer
    // budget than the JSON metadata calls. Both have a hard ceiling so a
    // hung connection can't pin a cron tick.
    const timeoutMs = isDiff ? 30_000 : 15_000;
    const maxAttempts = 2;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: accept ?? "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            ...options.headers,
          },
        });

        if (!response.ok) {
          const errorBody = await response.text();
          // Retry only on 5xx; 4xx is permanent (auth, missing, oversize).
          if (response.status >= 500 && attempt < maxAttempts) {
            lastError = new Error(`GitHub API ${response.status}: ${errorBody}`);
            await new Promise((r) => setTimeout(r, 500 * attempt));
            continue;
          }
          logger.error("GitHub API error", {
            statusCode: response.status,
            endpoint: endpoint.startsWith("http") ? new URL(endpoint).pathname : endpoint,
            error: errorBody,
          });
          throw new Error(`GitHub API error: ${response.status} - ${errorBody}`);
        }

        if (isDiff) {
          return (await response.text()) as unknown as T;
        }
        return (await response.json()) as T;
      } catch (err) {
        // AbortSignal.timeout fires a TimeoutError DOMException; treat it like 5xx.
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        if (isTimeout && attempt < maxAttempts) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("GitHub fetch failed");
  }

  async getRepositories(options: GetRepositoriesOptions = {}): Promise<VCSRepository[]> {
    const params = new URLSearchParams({
      per_page: String(options.perPage ?? 30),
      page: String(options.page ?? 1),
      sort: options.sort ?? "updated",
      direction: options.direction ?? "desc",
    });

    interface GitHubRepo {
      id: number;
      full_name: string;
      description: string | null;
      private: boolean;
      default_branch: string;
      html_url: string;
    }

    const repos = await this.fetch<GitHubRepo[]>(`/user/repos?${params}`);

    return repos.map((repo) => ({
      id: repo.id,
      fullName: repo.full_name,
      description: repo.description,
      isPrivate: repo.private,
      defaultBranch: repo.default_branch,
      htmlUrl: repo.html_url,
    }));
  }

  async getCommits(
    owner: string,
    repo: string,
    options: GetCommitsOptions = {}
  ): Promise<VCSCommit[]> {
    const params = new URLSearchParams({
      per_page: String(options.perPage ?? 30),
      page: String(options.page ?? 1),
    });

    if (options.since) params.set("since", options.since);
    if (options.until) params.set("until", options.until);
    if (options.sha) params.set("sha", options.sha);

    interface GitHubCommit {
      sha: string;
      commit: {
        message: string;
        author: {
          name: string;
          email: string;
          date: string;
        };
      };
      author: {
        avatar_url: string;
      } | null;
      parents: Array<{ sha: string }>;
      stats?: {
        additions: number;
        deletions: number;
      };
      files?: Array<{ filename: string }>;
    }

    const commits = await this.fetch<GitHubCommit[]>(`/repos/${owner}/${repo}/commits?${params}`);

    return commits.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      authorName: commit.commit.author.name,
      authorEmail: commit.commit.author.email,
      authorAvatarUrl: commit.author?.avatar_url ?? null,
      committedAt: commit.commit.author.date,
      additions: commit.stats?.additions ?? 0,
      deletions: commit.stats?.deletions ?? 0,
      changedFilesCount: commit.files?.length ?? 0,
      isMergeCommit: commit.parents.length > 1,
      parentShas: commit.parents.map((p) => p.sha),
    }));
  }

  async getCommitDiff(owner: string, repo: string, sha: string): Promise<VCSCommitDiff> {
    // 먼저 커밋 상세 정보 가져오기
    interface GitHubCommitDetail {
      sha: string;
      files: Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string;
      }>;
    }

    const commitDetail = await this.fetch<GitHubCommitDetail>(
      `/repos/${owner}/${repo}/commits/${sha}`
    );

    // diff 형식으로 가져오기
    const rawDiff = await this.fetch<string>(
      `/repos/${owner}/${repo}/commits/${sha}`,
      {},
      "application/vnd.github.diff"
    );

    const files: VCSFileDiff[] = commitDetail.files.map((file) => ({
      filename: file.filename,
      status: this.mapFileStatus(file.status),
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    }));

    return {
      sha,
      files,
      rawDiff,
    };
  }

  async getCommitDetail(
    owner: string,
    repo: string,
    sha: string
  ): Promise<{ additions: number; deletions: number; changedFilesCount: number }> {
    interface GitHubCommitDetail {
      stats: {
        additions: number;
        deletions: number;
        total: number;
      };
      files: Array<{ filename: string }>;
    }

    const detail = await this.fetch<GitHubCommitDetail>(`/repos/${owner}/${repo}/commits/${sha}`);

    return {
      additions: detail.stats?.additions ?? 0,
      deletions: detail.stats?.deletions ?? 0,
      changedFilesCount: detail.files?.length ?? 0,
    };
  }

  private mapFileStatus(status: string): "added" | "modified" | "removed" | "renamed" {
    switch (status) {
      case "added":
        return "added";
      case "removed":
        return "removed";
      case "renamed":
        return "renamed";
      default:
        return "modified";
    }
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<VCSFileContent | null> {
    try {
      const params = ref ? `?ref=${ref}` : "";

      interface GitHubContent {
        path: string;
        content: string;
        encoding: string;
      }

      const content = await this.fetch<GitHubContent>(
        `/repos/${owner}/${repo}/contents/${path}${params}`
      );

      // base64 디코딩
      const decodedContent =
        content.encoding === "base64" ? atob(content.content.replace(/\n/g, "")) : content.content;

      return {
        path: content.path,
        content: decodedContent,
        encoding: "utf-8",
      };
    } catch {
      // 파일이 없으면 null 반환
      return null;
    }
  }

  async verifyToken(): Promise<boolean> {
    try {
      await this.fetch("/user");
      return true;
    } catch {
      return false;
    }
  }

  async getAuthenticatedUser(): Promise<{ login: string; id: number; avatarUrl: string }> {
    interface GitHubUser {
      login: string;
      id: number;
      avatar_url: string;
    }

    const user = await this.fetch<GitHubUser>("/user");
    return {
      login: user.login,
      id: user.id,
      avatarUrl: user.avatar_url,
    };
  }

  /**
   * Get all commits authored by user across all repos via Repos API.
   * Uses /user/repos (sorted by pushed_at) + per-branch commit listing
   * with early termination when repo's pushed_at < since date.
   */
  async getAllRepoCommits(
    username: string,
    options: SearchCommitsOptions = {}
  ): Promise<VCSSearchCommit[]> {
    const { since, until } = options;
    const sinceDate = since ? new Date(since) : null;

    // Determine if this is an initial sync (since > 60 days ago)
    const isInitialSync =
      sinceDate !== null && Date.now() - sinceDate.getTime() > 60 * 24 * 60 * 60 * 1000;

    interface GitHubRepoRaw {
      id: number;
      full_name: string;
      private: boolean;
      pushed_at: string | null;
    }

    interface GitHubBranch {
      name: string;
    }

    interface GitHubCommitRaw {
      sha: string;
      commit: {
        message: string;
        author: {
          name: string;
          email: string;
          date: string;
        };
      };
      author: { avatar_url: string } | null;
      parents: Array<{ sha: string }>;
    }

    const allCommits: VCSSearchCommit[] = [];
    const seenShas = new Set<string>();
    let reposPage = 1;
    const reposPerPage = 100;
    let stopPagination = false;

    while (!stopPagination) {
      const params = new URLSearchParams({
        sort: "pushed",
        direction: "desc",
        per_page: String(reposPerPage),
        page: String(reposPage),
      });

      const repos = await this.fetch<GitHubRepoRaw[]>(`/user/repos?${params}`);

      if (repos.length === 0) break;

      for (const repo of repos) {
        // Early termination: if repo hasn't been pushed since sinceDate,
        // skip it and all subsequent repos (sorted by pushed desc).
        // Skip this optimization for initial sync to ensure full coverage.
        if (!isInitialSync && sinceDate && repo.pushed_at) {
          const repoPushedAt = new Date(repo.pushed_at);
          if (repoPushedAt < sinceDate) {
            console.log(
              `[Sync] Repo ${repo.full_name} pushed_at ${repo.pushed_at} < since ${since}, stopping`
            );
            stopPagination = true;
            break;
          }
        }

        const [owner, repoName] = repo.full_name.split("/");

        // Get all branches for this repo
        let branches: string[];
        try {
          const branchList = await this.fetch<GitHubBranch[]>(
            `/repos/${owner}/${repoName}/branches?per_page=100`
          );
          branches = branchList.map((b) => b.name);
        } catch {
          console.warn(`[Sync] Failed to list branches for ${repo.full_name}, skipping`);
          continue;
        }

        // Fetch commits for each branch
        for (const branch of branches) {
          let commitsPage = 1;
          let hasMoreCommits = true;

          while (hasMoreCommits) {
            const commitParams = new URLSearchParams({
              author: username,
              per_page: "100",
              page: String(commitsPage),
              sha: branch,
            });
            if (since) commitParams.set("since", since);
            if (until) commitParams.set("until", until);

            try {
              const repoCommits = await this.fetch<GitHubCommitRaw[]>(
                `/repos/${owner}/${repoName}/commits?${commitParams}`
              );

              for (const c of repoCommits) {
                // Deduplicate across branches (same commit may appear on multiple branches)
                if (seenShas.has(c.sha)) continue;
                seenShas.add(c.sha);

                allCommits.push({
                  sha: c.sha,
                  message: c.commit.message,
                  authorName: c.commit.author.name,
                  authorEmail: c.commit.author.email,
                  authorAvatarUrl: c.author?.avatar_url ?? null,
                  committedAt: c.commit.author.date,
                  repoFullName: repo.full_name,
                  repoId: repo.id,
                  repoIsPrivate: repo.private,
                  isMergeCommit: c.parents.length > 1,
                  parentShas: c.parents.map((p) => p.sha),
                });
              }

              if (repoCommits.length < 100) {
                hasMoreCommits = false;
              } else {
                commitsPage++;
              }
            } catch {
              // If fetching commits for a branch fails, skip it
              hasMoreCommits = false;
            }
          }
        }
      }

      if (repos.length < reposPerPage) {
        break;
      }
      reposPage++;
    }

    console.log(`[Sync] getAllRepoCommits found ${allCommits.length} commits across repos`);
    return allCommits;
  }
}

export function createGitHubAdapter(accessToken: string): GitHubAdapter {
  return new GitHubAdapter(accessToken);
}
