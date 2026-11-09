"use client";

import type { ReactNode } from "react";
import { formatCount, formatWon } from "@/lib/format";
import { formatBytes } from "@/lib/utils";
import { type CleanupItem, type ReparseItem, useCleanup, useReparse } from "../hooks";
import { ActionButton, BlockTitle, ProgressBar } from "./parts";

const TYPE_LABEL: Record<string, string> = {
  withdrawal: "출금",
  deposit: "입금",
  cancel: "결제 취소",
};

const ACTION_LABEL: Record<ReparseItem["action"], string> = {
  create: "새로 기록",
  update: "고침",
  skip: "그대로",
};

function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-[14px] bg-surface p-4 shadow-ring">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <BlockTitle>{title}</BlockTitle>
          <p className="m-0 text-[13px] leading-5 text-ink-2">{description}</p>
        </div>
        <div className="flex flex-none items-center gap-2">{action}</div>
      </div>
      {children}
    </section>
  );
}

function Preview({ title, text }: { title: string | null; text: string | null }) {
  const full = `${title || "(제목 없음)"} — ${text || "(내용 없음)"}`;
  return (
    <p className="m-0 line-clamp-2 text-xs leading-[18px] break-words text-ink-3" title={full}>
      {full}
    </p>
  );
}

function ItemList({ children }: { children: ReactNode }) {
  return (
    <div className="max-h-60 overflow-y-auto border-t border-line">
      <ul className="m-0 flex list-none flex-col p-0">{children}</ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="text-ink-2">
      {label} <span className="num font-semibold text-ink">{formatCount(value)}</span>
    </span>
  );
}

function ReparsePanel({ onChanged }: { onChanged: () => void }) {
  const { preview, apply, result, progress, isLoading, clear } = useReparse();
  const changes = result?.items.filter((i) => i.action !== "skip") ?? [];
  const pending = result?.dryRun ? result.created + result.updated : 0;

  const action =
    !result && !progress ? (
      <ActionButton onClick={preview} disabled={isLoading}>
        미리보기
      </ActionButton>
    ) : result?.dryRun ? (
      <>
        <ActionButton variant="ghost" onClick={clear} disabled={isLoading}>
          취소
        </ActionButton>
        <ActionButton
          variant="primary"
          disabled={isLoading || pending === 0}
          onClick={async () => {
            await apply();
            onChanged();
          }}
        >
          {pending > 0 ? `${formatCount(pending)}건 적용` : "바뀔 거래 없음"}
        </ActionButton>
      </>
    ) : result ? (
      <ActionButton variant="ghost" onClick={clear}>
        닫기
      </ActionButton>
    ) : null;

  return (
    <Panel
      title="알림 다시 분석"
      description="분석 규칙이 바뀌었을 때 기존 알림을 다시 읽어 빠진 거래를 채우고 틀린 거래를 고쳐요."
      action={action}
    >
      {progress ? (
        <div className="flex flex-col gap-2">
          <span className="num text-xs text-ink-2">
            {formatCount(progress.processed)} / {formatCount(progress.total)}건 확인 중
          </span>
          <ProgressBar
            value={progress.total > 0 ? progress.processed / progress.total : 0}
            label="다시 분석 진행률"
          />
          <span className="flex gap-3 text-xs">
            <Stat label="새로 기록" value={progress.created} />
            <Stat label="고침" value={progress.updated} />
            <Stat label="그대로" value={progress.skipped} />
          </span>
        </div>
      ) : null}
      {result ? (
        <div className="ds-reveal flex flex-col gap-2">
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Stat label="알림" value={result.total} />
            <Stat label="새로 기록" value={result.created} />
            <Stat label="고침" value={result.updated} />
            <Stat label="그대로" value={result.skipped} />
            {result.failed > 0 ? <Stat label="실패" value={result.failed} /> : null}
            {!result.dryRun ? <span className="font-semibold text-ink">적용했어요</span> : null}
          </span>
          {changes.length > 0 ? (
            <ItemList>
              {changes.map((item) => (
                <li
                  key={item.logId}
                  className="flex flex-col gap-0.5 border-b border-line py-2 last:border-b-0"
                >
                  <span className="text-xs font-semibold">
                    {ACTION_LABEL[item.action]}
                    {item.parsed ? (
                      <span className="num ml-2 font-normal text-ink-2">
                        {TYPE_LABEL[item.parsed.type] ?? item.parsed.type}{" "}
                        {formatWon(item.parsed.amount)} · {item.parsed.merchant}
                      </span>
                    ) : null}
                  </span>
                  <Preview title={item.title} text={item.text} />
                  {item.reason ? <span className="text-xs text-ink-3">{item.reason}</span> : null}
                </li>
              ))}
            </ItemList>
          ) : (
            <span className="text-xs text-ink-2">바뀌는 거래가 없어요.</span>
          )}
        </div>
      ) : null}
    </Panel>
  );
}

function CleanupPanel({ onChanged }: { onChanged: () => void }) {
  const { preview, execute, result, progress, isLoading, clear } = useCleanup();

  const action =
    !result && !progress ? (
      <ActionButton onClick={preview} disabled={isLoading}>
        미리보기
      </ActionButton>
    ) : result && !result.dryRun ? (
      <ActionButton
        variant="ghost"
        onClick={() => {
          clear();
          onChanged();
        }}
      >
        닫기
      </ActionButton>
    ) : result?.dryRun ? (
      <>
        <ActionButton variant="ghost" onClick={clear} disabled={isLoading}>
          취소
        </ActionButton>
        {result.deletable > 0 ? (
          <ActionButton
            variant="danger"
            disabled={isLoading}
            onClick={async () => {
              await execute();
              onChanged();
            }}
          >
            {formatCount(result.deletable)}건 삭제
          </ActionButton>
        ) : null}
      </>
    ) : null;

  const reparsePct =
    progress?.phase === "reparse" && (progress.reparseTotal ?? 0) > 0
      ? (progress.reparseProcessed ?? 0) / (progress.reparseTotal ?? 1)
      : 0;
  const deletePct =
    progress?.phase === "cleanup" && (progress.deletableTotal ?? 0) > 0
      ? (progress.deleted ?? 0) / (progress.deletableTotal ?? 1)
      : 0;

  return (
    <Panel
      title="알림 정리"
      description="다시 분석해도 거래가 아닌 알림(광고, 이벤트 등)을 지워 저장 공간을 비워요."
      action={action}
    >
      {progress ? (
        <div className="flex flex-col gap-2">
          <span className="num text-xs text-ink-2">
            {progress.phase === "reparse"
              ? `1단계 · 다시 분석 ${formatCount(progress.reparseProcessed ?? 0)} / ${formatCount(progress.reparseTotal ?? 0)}건`
              : `2단계 · 삭제 ${formatCount(progress.deleted ?? 0)} / ${formatCount(progress.deletableTotal ?? 0)}건`}
          </span>
          <ProgressBar
            value={progress.phase === "reparse" ? reparsePct : deletePct}
            label="알림 정리 진행률"
          />
        </div>
      ) : null}
      {result ? (
        <div className="ds-reveal flex flex-col gap-2">
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Stat label="다시 분석 · 새로 기록" value={result.reparseCreated} />
            <Stat label="고침" value={result.reparseUpdated} />
            {result.dryRun ? (
              <span className="text-ink-2">
                지울 알림{" "}
                <span className="num font-semibold text-ink">{formatCount(result.deletable)}</span>
                건 · 약 {formatBytes(result.estimatedBytes)}
              </span>
            ) : (
              <span className="font-semibold text-ink">
                {formatCount(result.deleted)}건 삭제 · 약 {formatBytes(result.estimatedBytes)} 확보
              </span>
            )}
          </span>
          {result.dryRun && result.items.length > 0 ? (
            <ItemList>
              {result.items.map((item: CleanupItem) => (
                <li
                  key={item.logId}
                  className="flex flex-col gap-0.5 border-b border-line py-2 last:border-b-0"
                >
                  <span className="text-xs font-semibold">
                    {item.reason}
                    <span className="num ml-2 font-normal text-ink-3">
                      {formatBytes(item.bytes)}
                    </span>
                  </span>
                  <Preview title={item.title} text={item.text} />
                </li>
              ))}
            </ItemList>
          ) : null}
          {result.dryRun && result.deletable === 0 ? (
            <span className="text-xs text-ink-2">지울 알림이 없어요.</span>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

/** The two bulk maintenance actions over every stored notification. */
export function BulkPanels({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ReparsePanel onChanged={onChanged} />
      <CleanupPanel onChanged={onChanged} />
    </div>
  );
}
