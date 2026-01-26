import type { Database } from "@/db";
import { createGitHubAdapter } from "@/lib/adapters/vcs/github";
import type { VCSCommit } from "@/lib/adapters/vcs/interface";

export class GitHubService {
  private db: Database;
  private accessToken: string;

  constructor(db: Database, accessToken: string) {
    this.db = db;
    this.accessToken = accessToken;
  }

  private get adapter() {
    return createGitHubAdapter(this.accessToken);
  }

  /**
   * GitHub에서 커밋 목록 가져오기
   */
  async fetchCommits(
    owner: string,
    repo: string,
    options: { since?: string; perPage?: number } = {}
  ): Promise<VCSCommit[]> {
    return this.adapter.getCommits(owner, repo, options);
  }

  /**
   * 커밋 diff 가져오기
   */
  async getCommitDiff(owner: string, repo: string, sha: string) {
    return this.adapter.getCommitDiff(owner, repo, sha);
  }

  /**
   * 파일 내용 가져오기 (CLAUDE.md, README.md 등)
   */
  async getFileContent(owner: string, repo: string, path: string) {
    return this.adapter.getFileContent(owner, repo, path);
  }

  /**
   * Get user events (PushEvent)
   */
  async getUserEvents(username: string, perPage: number = 100) {
    return this.adapter.getUserEvents(username, perPage);
  }

  /**
   * Search user commits
   */
  async searchUserCommits(
    username: string,
    options: { since?: string; until?: string; perPage?: number; page?: number } = {}
  ) {
    return this.adapter.searchUserCommits(username, options);
  }

  /**
   * Get authenticated user info
   */
  async getAuthenticatedUser() {
    return this.adapter.getAuthenticatedUser();
  }
}

export function createGitHubService(
  db: Database,
  accessToken: string
): GitHubService {
  return new GitHubService(db, accessToken);
}
