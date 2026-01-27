import type {
  VCSAdapter,
  VCSRepository,
  VCSCommit,
  VCSCommitDiff,
  VCSFileDiff,
  VCSFileContent,
  VCSPushEvent,
  VCSEventCommit,
  VCSSearchCommit,
  GetCommitsOptions,
  GetRepositoriesOptions,
  SearchCommitsOptions,
} from "./interface";

const GITHUB_API_BASE = "https://api.github.com";

export class GitHubAdapter implements VCSAdapter {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {},
    accept?: string
  ): Promise<T> {
    const url = endpoint.startsWith("http")
      ? endpoint
      : `${GITHUB_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: accept ?? "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${response.status} - ${error}`);
    }

    // diff 요청 시 텍스트로 반환
    if (accept === "application/vnd.github.diff") {
      return response.text() as unknown as T;
    }

    return response.json() as Promise<T>;
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

    const commits = await this.fetch<GitHubCommit[]>(
      `/repos/${owner}/${repo}/commits?${params}`
    );

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

  async getCommitDiff(
    owner: string,
    repo: string,
    sha: string
  ): Promise<VCSCommitDiff> {
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

    const detail = await this.fetch<GitHubCommitDetail>(
      `/repos/${owner}/${repo}/commits/${sha}`
    );

    return {
      additions: detail.stats?.additions ?? 0,
      deletions: detail.stats?.deletions ?? 0,
      changedFilesCount: detail.files?.length ?? 0,
    };
  }

  private mapFileStatus(
    status: string
  ): "added" | "modified" | "removed" | "renamed" {
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
        content.encoding === "base64"
          ? atob(content.content.replace(/\n/g, ""))
          : content.content;

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
   * Get user's recent push events from Events API
   * Note: Events API only returns events from the last 90 days
   */
  async getUserEvents(username: string, perPage: number = 100): Promise<VCSPushEvent[]> {
    interface GitHubEvent {
      id: string;
      type: string;
      repo: {
        id: number;
        name: string; // 'owner/repo' format
      };
      payload: {
        commits?: Array<{
          sha: string;
          message: string;
          author: {
            name: string;
            email: string;
          };
        }>;
        ref?: string;
      };
      public: boolean;
      created_at: string;
    }

    const params = new URLSearchParams({
      per_page: String(perPage),
    });

    const events = await this.fetch<GitHubEvent[]>(
      `/users/${username}/events?${params}`
    );

    // Filter only PushEvents and transform
    const pushEvents: VCSPushEvent[] = [];

    for (const event of events) {
      if (event.type !== "PushEvent" || !event.payload.commits) {
        continue;
      }

      const commits: VCSEventCommit[] = event.payload.commits.map((commit) => ({
        sha: commit.sha,
        message: commit.message,
        authorName: commit.author.name,
        authorEmail: commit.author.email,
        committedAt: event.created_at, // Events API doesn't have individual commit timestamps
      }));

      pushEvents.push({
        eventId: event.id,
        repoFullName: event.repo.name,
        repoId: event.repo.id,
        repoIsPrivate: !event.public,
        commits,
        pushedAt: event.created_at,
      });
    }

    return pushEvents;
  }

  /**
   * Search commits authored by user via Search API
   * Search API is rate-limited but allows searching across all repos
   */
  async searchUserCommits(
    username: string,
    options: SearchCommitsOptions = {}
  ): Promise<VCSSearchCommit[]> {
    const { since, until, perPage = 100, page = 1 } = options;

    // Build search query
    let query = `author:${username}`;
    if (since) {
      // GitHub search uses YYYY-MM-DD format
      query += ` author-date:>=${since.slice(0, 10)}`;
    }
    if (until) {
      query += ` author-date:<=${until.slice(0, 10)}`;
    }

    const params = new URLSearchParams({
      q: query,
      sort: "author-date",
      order: "desc",
      per_page: String(perPage),
      page: String(page),
    });

    interface GitHubSearchResponse {
      total_count: number;
      incomplete_results: boolean;
      items: Array<{
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
        repository: {
          id: number;
          full_name: string;
          private: boolean;
        };
      }>;
    }

    const response = await this.fetch<GitHubSearchResponse>(
      `/search/commits?${params}`,
      {},
      "application/vnd.github.cloak-preview+json" // Required for commit search
    );

    return response.items.map((item) => ({
      sha: item.sha,
      message: item.commit.message,
      authorName: item.commit.author.name,
      authorEmail: item.commit.author.email,
      authorAvatarUrl: item.author?.avatar_url ?? null,
      committedAt: item.commit.author.date,
      repoFullName: item.repository.full_name,
      repoId: item.repository.id,
      repoIsPrivate: item.repository.private,
      isMergeCommit: item.parents.length > 1,
      parentShas: item.parents.map((p) => p.sha),
    }));
  }
}

export function createGitHubAdapter(accessToken: string): VCSAdapter {
  return new GitHubAdapter(accessToken);
}
