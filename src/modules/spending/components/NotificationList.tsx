"use client";

import { useState } from "react";
import { toKstCalendarDate } from "@/lib/date-key";
import { formatDateTime, formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NotificationLogItem } from "../hooks";
import { ActionButton } from "./parts";

function groupByDay(logs: NotificationLogItem[]) {
  const days = new Map<string, NotificationLogItem[]>();
  for (const log of logs) {
    const key = toKstCalendarDate(new Date(log.receivedAt));
    days.set(key, [...(days.get(key) ?? []), log]);
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function LogRow({
  log,
  onDeleteTransaction,
}: {
  log: NotificationLogItem;
  onDeleteTransaction: (transactionId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const at = new Date(log.receivedAt);
  const id = `log-${log.id}`;
  return (
    <div className="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="grid min-h-11 w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-0 bg-transparent px-0 py-3 text-left text-ink transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-brand sm:grid-cols-[52px_minmax(0,1fr)_auto] sm:gap-4 sm:px-2 [@media(hover:hover)]:hover:bg-sunken"
      >
        <span className="num hidden text-[13px] text-ink-3 sm:block">{formatTime(at)}</span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{log.title || "(제목 없음)"}</span>
          <span className="truncate text-xs leading-4 text-ink-3">
            <span className="sm:hidden">{formatTime(at)} · </span>
            {log.text || "(내용 없음)"}
          </span>
        </span>
        <span className={cn("text-xs whitespace-nowrap", log.parsed ? "text-ink-2" : "text-ink-3")}>
          {log.parsed ? "거래로 기록됨" : "거래 아님"}
        </span>
      </button>
      {open ? (
        <div id={id} className="ds-reveal flex flex-col gap-3 pb-3.5 sm:pl-[76px]">
          <p className="m-0 text-[13px] leading-5 break-words whitespace-pre-wrap">
            {log.text || "(내용 없음)"}
          </p>
          <span className="text-xs text-ink-3">
            {formatDateTime(at)} 수신 · {log.source}
          </span>
          {log.parsed && log.transactionId ? (
            confirming ? (
              <div className="ds-reveal flex flex-wrap items-center gap-2">
                <span className="text-[13px] leading-5">
                  이 알림으로 기록된 거래를 삭제할까요? 소비 집계에서 바로 빠져요.
                </span>
                <span className="flex gap-2">
                  <ActionButton
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    취소
                  </ActionButton>
                  <ActionButton
                    variant="danger"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onDeleteTransaction(log.transactionId as string);
                      } finally {
                        setBusy(false);
                        setConfirming(false);
                      }
                    }}
                  >
                    삭제
                  </ActionButton>
                </span>
              </div>
            ) : (
              <div>
                <ActionButton variant="ghost" onClick={() => setConfirming(true)}>
                  기록된 거래 삭제
                </ActionButton>
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Raw Toss notifications grouped by KST day; each row opens to its full text. */
export function NotificationList({
  logs,
  onDeleteTransaction,
}: {
  logs: NotificationLogItem[];
  onDeleteTransaction: (transactionId: string) => Promise<boolean>;
}) {
  return (
    <div className="flex flex-col">
      {groupByDay(logs).map(([key, items]) => (
        <section key={key} aria-label={formatDay(key)}>
          <div className="flex items-baseline justify-between gap-3 border-b border-line pt-5 pb-2 sm:px-2">
            <h3 className="m-0 text-sm font-semibold">{formatDay(key)}</h3>
            <span className="num text-[13px] text-ink-2">
              알림 {items.length}건 · 거래 {items.filter((l) => l.parsed).length}건
            </span>
          </div>
          {items.map((log) => (
            <LogRow key={log.id} log={log} onDeleteTransaction={onDeleteTransaction} />
          ))}
        </section>
      ))}
    </div>
  );
}
