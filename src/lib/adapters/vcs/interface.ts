/**
 * VCS (Version Control System) Adapter Interface
 *
 * Abstraction layer for version control systems.
 * Currently supports GitHub, designed for future extensibility (GitLab, Bitbucket).
 */

export interface VCSRepository {
  id: number;
  fullName: string; // 'owner/repo'
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
  committedAt: string; // ISO 8601
  additions: number;
  deletions: number;
  changedFilesCount: number;
  isMergeCommit: boolean;
  parentShas: string[];
}

export interface VCSCommitDiff {
  sha: string;
  files: VCSFileDiff[];
  rawDiff: string;
}

export interface VCSFileDiff {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
}

export interface VCSFileContent {
  path: string;
  content: string;
  encoding: string;
}

export interface GetCommitsOptions {
  since?: string; // ISO 8601 date
  until?: string;
  perPage?: number;
  page?: number;
  sha?: string; // branch or commit SHA to start from
}

export interface GetRepositoriesOptions {
  perPage?: number;
  page?: number;
  sort?: "created" | "updated" | "pushed" | "full_name";
  direction?: "asc" | "desc";
}

export interface SearchCommitsOptions {
  since?: string; // ISO 8601 date
  until?: string;
  perPage?: number;
  page?: number;
}

export interface VCSPushEvent {
  eventId: string;
  repoFullName: string;
  repoId: number;
  repoIsPrivate: boolean;
  commits: VCSEventCommit[];
  pushedAt: string;
}

export interface VCSEventCommit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string | null;
  committedAt: string;
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

export interface VCSAdapter {
  /**
   * Get list of repositories accessible by the authenticated user
   */
  getRepositories(options?: GetRepositoriesOptions): Promise<VCSRepository[]>;

  /**
   * Get commits for a repository
   */
  getCommits(
    owner: string,
    repo: string,
    options?: GetCommitsOptions
  ): Promise<VCSCommit[]>;

  /**
   * Get detailed commit information including diff
   */
  getCommitDiff(owner: string, repo: string, sha: string): Promise<VCSCommitDiff>;

  /**
   * Get file content from repository
   */
  getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string
  ): Promise<VCSFileContent | null>;

  /**
   * Verify if the access token is still valid
   */
  verifyToken(): Promise<boolean>;

  /**
   * Get user's recent push events from Events API
   */
  getUserEvents(username: string, perPage?: number): Promise<VCSPushEvent[]>;

  /**
   * Search commits authored by user via Search API
   */
  searchUserCommits(
    username: string,
    options?: SearchCommitsOptions
  ): Promise<VCSSearchCommit[]>;

  /**
   * Get authenticated user info
   */
  getAuthenticatedUser(): Promise<{ login: string; id: number; avatarUrl: string }>;
}
