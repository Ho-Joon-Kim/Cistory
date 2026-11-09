"use client";

import Link from "next/link";
import { EmptyState, LoadingState, PageContainer, PageTitle, SourceTile } from "@/components/ds";
import { Header } from "@/components/Layout/Header";
import { shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { formatCount, formatDateTime, formatRelative, formatShare } from "@/lib/format";
import { useRequireAuth } from "@/modules/auth/hooks";
import { SyncStatusProvider } from "@/modules/sync/hooks";
import { useRepositories } from "@/modules/timeline/hooks";

/**
 * The repository's commits in record search: the year up to its latest commit
 * (search caps a range at 366 days), commits only.
 */
function repoCommitsHref(fullName: string, lastCommitAt: string): string {
  const to = toKstCalendarDate(new Date(lastCommitAt));
  const p = new URLSearchParams({
    q: "",
    from: shiftDateKey(to, -365),
    to,
    source: "commit",
    repo: fullName,
  });
  return `/search?${p}`;
}

export default function RepositoriesPage() {
  const { isLoading: isAuthLoading, isAuthenticated } = useRequireAuth();
  const { repositories, isLoading } = useRepositories(isAuthenticated);

  if (isAuthLoading) {
    return (
      <div className="mx-auto max-w-[760px] p-8">
        <LoadingState variant="rows" rows={6} label="로딩 중" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const totalCommits = repositories.reduce((sum, r) => sum + Number(r.commitCount), 0);
  const max = repositories.reduce((m, r) => Math.max(m, Number(r.commitCount)), 0);

  return (
    <SyncStatusProvider>
      <div className="min-h-screen bg-page">
        <Header />
        <PageContainer>
          <div className="mx-auto max-w-[880px]">
            <PageTitle
              className="ds-enter"
              title="레포지토리"
              meta={
                <>
                  <span className="num">{formatCount(repositories.length)}</span>개 레포지토리 ·
                  커밋 <span className="num">{formatCount(totalCommits)}</span>개
                </>
              }
            />
            <div className="ds-enter mt-8 [animation-delay:100ms]">
              {isLoading ? (
                <LoadingState variant="rows" rows={6} label="레포지토리를 불러오는 중" />
              ) : repositories.length === 0 ? (
                <EmptyState
                  title="동기화된 레포지토리가 없어요"
                  description="상단의 동기화 버튼을 눌러 GitHub 커밋을 가져오세요."
                />
              ) : (
                <ul className="m-0 list-none border-t border-line p-0">
                  {repositories.map((repo) => {
                    const count = Number(repo.commitCount);
                    const [owner, name] = repo.fullName.includes("/")
                      ? [repo.fullName.split("/")[0], repo.fullName.split("/").slice(1).join("/")]
                      : ["", repo.fullName];
                    return (
                      <li key={repo.fullName} className="border-b border-line">
                        <Link
                          href={repoCommitsHref(repo.fullName, repo.lastCommitAt)}
                          className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 py-3 text-ink no-underline transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--sunken)_70%,transparent)] focus-visible:outline-2 focus-visible:outline-brand sm:grid-cols-[32px_minmax(0,1fr)_160px_96px]"
                        >
                          <SourceTile icon="github" />
                          <span className="flex min-w-0 flex-col">
                            <span
                              className="text-[15px] leading-[22px] font-semibold [overflow-wrap:anywhere]"
                              title={repo.fullName}
                            >
                              {name}
                            </span>
                            <span className="text-[13px] leading-[18px] text-ink-3">
                              {owner ? (
                                <span className="max-[400px]:hidden">{owner} · </span>
                              ) : null}
                              {repo.isPrivate
                                ? "비공개 · "
                                : repo.isPrivate === false
                                  ? "공개 · "
                                  : null}
                              <time
                                className="whitespace-nowrap"
                                dateTime={repo.lastCommitAt}
                                title={formatDateTime(new Date(repo.lastCommitAt))}
                              >
                                마지막 커밋 {formatRelative(repo.lastCommitAt)}
                              </time>
                            </span>
                          </span>
                          <span
                            aria-hidden="true"
                            className="hidden h-1.5 overflow-hidden rounded-full bg-track sm:block"
                          >
                            <span
                              className="ds-growx block h-full rounded-full bg-brand"
                              style={{ width: max ? `${(count / max) * 100}%` : 0 }}
                            />
                          </span>
                          <span className="text-right text-[15px] leading-[22px]">
                            <span className="num font-medium">{formatCount(count)}</span>
                            <span className="text-xs text-ink-3">개</span>
                            <span className="sr-only">
                              {" "}
                              커밋, 전체의 {formatShare(totalCommits ? count / totalCommits : 0)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </PageContainer>
      </div>
    </SyncStatusProvider>
  );
}
