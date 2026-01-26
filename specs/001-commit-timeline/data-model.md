# Data Model: Cistory - GitHub Commit Timeline

**Branch**: `001-commit-timeline` | **Date**: 2026-01-26

## Entity Relationship Diagram

```
┌─────────────┐       ┌──────────────┐       ┌─────────────┐
│    User     │ 1───* │  Repository  │ 1───* │   Commit    │
└─────────────┘       └──────────────┘       └─────────────┘
                                                    │
                                                    │ 1
                                                    │
                                                    ▼ 1
                                            ┌──────────────┐
                                            │CommitSummary │
                                            └──────────────┘

┌─────────────┐
│   SyncJob   │ ───* Repository (via repo_id)
└─────────────┘
```

---

## Entities

### User

서비스 사용자. GitHub 계정과 연동된 단일 사용자.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PK | UUID |
| github_id | INTEGER | UNIQUE, NOT NULL | GitHub 사용자 ID |
| github_login | TEXT | NOT NULL | GitHub 사용자명 |
| github_avatar_url | TEXT | | 프로필 이미지 URL |
| github_access_token | TEXT | NOT NULL | OAuth Access Token (암호화 저장) |
| theme | TEXT | DEFAULT 'system' | 'light', 'dark', 'system' |
| sync_interval_hours | INTEGER | DEFAULT 1 | 자동 동기화 주기 (1-24) |
| created_at | TEXT | NOT NULL | ISO 8601 timestamp |
| updated_at | TEXT | NOT NULL | ISO 8601 timestamp |

**Indexes**:
- `idx_user_github_id` ON (github_id)

---

### Repository

추적 중인 GitHub 레포지토리.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PK | UUID |
| user_id | TEXT | FK → User.id, NOT NULL | 소유 사용자 |
| github_repo_id | INTEGER | NOT NULL | GitHub 레포지토리 ID |
| github_full_name | TEXT | NOT NULL | 'owner/repo' 형식 |
| github_description | TEXT | | 레포지토리 설명 |
| github_default_branch | TEXT | DEFAULT 'main' | 기본 브랜치명 |
| is_private | INTEGER | DEFAULT 0 | 0: public, 1: private |
| is_active | INTEGER | DEFAULT 1 | 0: 비활성화, 1: 추적 중 |
| last_synced_at | TEXT | | 마지막 동기화 시간 |
| last_commit_sha | TEXT | | 마지막 동기화된 커밋 SHA |
| created_at | TEXT | NOT NULL | ISO 8601 timestamp |
| updated_at | TEXT | NOT NULL | ISO 8601 timestamp |

**Indexes**:
- `idx_repo_user_id` ON (user_id)
- `idx_repo_github_id` ON (github_repo_id)
- UNIQUE (user_id, github_repo_id)

**Validation Rules**:
- github_full_name은 'owner/repo' 형식이어야 함
- sync 상태가 변경될 때 last_synced_at 업데이트

---

### Commit

개별 커밋 정보.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PK | UUID |
| repository_id | TEXT | FK → Repository.id, NOT NULL | 소속 레포지토리 |
| sha | TEXT | NOT NULL | Git commit SHA (40자) |
| message | TEXT | NOT NULL | 커밋 메시지 |
| author_name | TEXT | NOT NULL | 작성자 이름 |
| author_email | TEXT | | 작성자 이메일 |
| author_avatar_url | TEXT | | 작성자 아바타 URL |
| committed_at | TEXT | NOT NULL | 커밋 시간 (ISO 8601) |
| additions | INTEGER | DEFAULT 0 | 추가된 라인 수 |
| deletions | INTEGER | DEFAULT 0 | 삭제된 라인 수 |
| changed_files_count | INTEGER | DEFAULT 0 | 변경된 파일 수 |
| is_merge_commit | INTEGER | DEFAULT 0 | 0: 일반, 1: 머지 커밋 |
| parent_shas | TEXT | | JSON array of parent SHAs |
| created_at | TEXT | NOT NULL | ISO 8601 timestamp |

**Indexes**:
- `idx_commit_repo_id` ON (repository_id)
- `idx_commit_committed_at` ON (committed_at DESC)
- UNIQUE (repository_id, sha)

**Validation Rules**:
- sha는 40자 hex string
- committed_at은 유효한 ISO 8601 timestamp

---

### CommitSummary

커밋에 대한 AI 생성 요약.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PK | UUID |
| commit_id | TEXT | FK → Commit.id, UNIQUE, NOT NULL | 대상 커밋 |
| technical_summary | TEXT | | 기술자 관점 요약 |
| non_technical_summary | TEXT | | 비기술자 관점 요약 |
| status | TEXT | DEFAULT 'pending' | 'pending', 'processing', 'completed', 'failed' |
| retry_count | INTEGER | DEFAULT 0 | 재시도 횟수 |
| error_message | TEXT | | 실패 시 에러 메시지 |
| created_at | TEXT | NOT NULL | ISO 8601 timestamp |
| updated_at | TEXT | NOT NULL | ISO 8601 timestamp |

**Indexes**:
- `idx_summary_commit_id` ON (commit_id)
- `idx_summary_status` ON (status)

**State Transitions**:
```
pending → processing → completed
                    ↘ failed (retry_count < 3)
                           ↘ failed (final, retry_count >= 3)
```

---

### SyncJob

동기화 작업 정보.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT | PK | UUID |
| user_id | TEXT | FK → User.id, NOT NULL | 실행 사용자 |
| repository_id | TEXT | FK → Repository.id | NULL이면 전체 레포 동기화 |
| status | TEXT | DEFAULT 'pending' | 'pending', 'fetching', 'summarizing', 'completed', 'failed' |
| trigger_type | TEXT | NOT NULL | 'manual', 'scheduled' |
| total_commits | INTEGER | DEFAULT 0 | 처리할 총 커밋 수 |
| processed_commits | INTEGER | DEFAULT 0 | 처리 완료된 커밋 수 |
| error_message | TEXT | | 실패 시 에러 메시지 |
| started_at | TEXT | | 시작 시간 |
| completed_at | TEXT | | 완료 시간 |
| created_at | TEXT | NOT NULL | ISO 8601 timestamp |

**Indexes**:
- `idx_sync_user_id` ON (user_id)
- `idx_sync_status` ON (status)
- `idx_sync_created_at` ON (created_at DESC)

**State Transitions**:
```
pending → fetching → summarizing → completed
                  ↘ failed
             ↘ failed
```

---

## Drizzle Schema (TypeScript)

```typescript
// db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  githubId: integer('github_id').notNull().unique(),
  githubLogin: text('github_login').notNull(),
  githubAvatarUrl: text('github_avatar_url'),
  githubAccessToken: text('github_access_token').notNull(),
  theme: text('theme').default('system'),
  syncIntervalHours: integer('sync_interval_hours').default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  githubRepoId: integer('github_repo_id').notNull(),
  githubFullName: text('github_full_name').notNull(),
  githubDescription: text('github_description'),
  githubDefaultBranch: text('github_default_branch').default('main'),
  isPrivate: integer('is_private').default(0),
  isActive: integer('is_active').default(1),
  lastSyncedAt: text('last_synced_at'),
  lastCommitSha: text('last_commit_sha'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const commits = sqliteTable('commits', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  sha: text('sha').notNull(),
  message: text('message').notNull(),
  authorName: text('author_name').notNull(),
  authorEmail: text('author_email'),
  authorAvatarUrl: text('author_avatar_url'),
  committedAt: text('committed_at').notNull(),
  additions: integer('additions').default(0),
  deletions: integer('deletions').default(0),
  changedFilesCount: integer('changed_files_count').default(0),
  isMergeCommit: integer('is_merge_commit').default(0),
  parentShas: text('parent_shas'), // JSON array
  createdAt: text('created_at').notNull(),
});

export const commitSummaries = sqliteTable('commit_summaries', {
  id: text('id').primaryKey(),
  commitId: text('commit_id').notNull().unique().references(() => commits.id, { onDelete: 'cascade' }),
  technicalSummary: text('technical_summary'),
  nonTechnicalSummary: text('non_technical_summary'),
  status: text('status').default('pending'),
  retryCount: integer('retry_count').default(0),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const syncJobs = sqliteTable('sync_jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  repositoryId: text('repository_id').references(() => repositories.id, { onDelete: 'cascade' }),
  status: text('status').default('pending'),
  triggerType: text('trigger_type').notNull(),
  totalCommits: integer('total_commits').default(0),
  processedCommits: integer('processed_commits').default(0),
  errorMessage: text('error_message'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
});
```

---

## Query Patterns

### 1. 통합 타임라인 조회 (최신순)

```sql
SELECT c.*, r.github_full_name, cs.non_technical_summary, cs.technical_summary, cs.status as summary_status
FROM commits c
JOIN repositories r ON c.repository_id = r.id
LEFT JOIN commit_summaries cs ON c.id = cs.commit_id
WHERE r.user_id = ? AND r.is_active = 1
ORDER BY c.committed_at DESC
LIMIT ? OFFSET ?
```

### 2. 레포지토리 필터링

```sql
-- 위 쿼리에 추가
AND r.id IN (?, ?, ...)
```

### 3. 날짜 범위 필터링

```sql
-- 위 쿼리에 추가
AND c.committed_at BETWEEN ? AND ?
```

### 4. 요약 대기 중인 커밋 조회

```sql
SELECT c.id, c.sha, c.message, r.github_full_name
FROM commits c
JOIN repositories r ON c.repository_id = r.id
JOIN commit_summaries cs ON c.id = cs.commit_id
WHERE cs.status = 'pending'
ORDER BY c.committed_at DESC
LIMIT 10
```
