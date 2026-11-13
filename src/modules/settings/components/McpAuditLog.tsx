"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import type { SourceStatus } from "@/components/ds";
import { LoadingState, Segmented, Sheet, StatusBadge } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/auth-client";
import { toKstCalendarDate } from "@/lib/date-key";
import {
  formatCount,
  formatDateRange,
  formatDateTime,
  formatMonthDay,
  formatTime,
} from "@/lib/format";
import { userErrorMessage } from "@/lib/user-error";
import { cn } from "@/lib/utils";
import { type McpTokenView, mcpFetch, useMcpTokens } from "./McpTokensCard";
import { PanelActions, PanelNote, PanelText } from "./panel";

// ── Data ─────────────────────────────────────────────────────────────────────

type Outcome = "ok" | "error" | "denied";

/** `AuditLogEntry` as it arrives over JSON. */
interface AuditEntry {
  id: string;
  at: string;
  tokenId: string | null;
  tool: string | null;
  outcome: Outcome;
  denyReason: string | null;
  errorCode: string | null;
  argsSummary: unknown;
  resultCount: number | null;
  ip: string | null;
  country: string | null;
  writeBefore: unknown;
  writeAfter: unknown;
  hitCount: number;
  windowStart: string | null;
}

interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

interface Filters {
  tokenId: string;
  tool: string;
  outcome: "" | Outcome;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { tokenId: "", tool: "", outcome: "", from: "", to: "" };
const AUDIT_KEY = "mcp-audit";
const PAGE_SIZE = 30;

// ── Labels ───────────────────────────────────────────────────────────────────

export const DENY_REASON_LABELS: Record<string, string> = {
  token_unrecognized: "알 수 없는 토큰",
  token_revoked: "폐기된 토큰",
  token_expired: "만료된 토큰",
  ip_unknown: "접속 IP 확인 불가",
  ip_not_allowed: "허용하지 않은 IP",
  country_unknown: "접속 국가 확인 불가",
  country_not_allowed: "허용하지 않은 국가",
  scope_denied: "스코프 없음",
  revoked_midflight: "요청 중 폐기됨",
  origin_not_allowed: "허용하지 않은 출처",
};

export function denyReasonLabel(reason: string | null): string {
  return (reason && DENY_REASON_LABELS[reason]) ?? "거부";
}

const OUTCOME_BADGE: Record<Outcome, { status: SourceStatus; label: string }> = {
  ok: { status: "ok", label: "성공" },
  error: { status: "delayed", label: "오류" },
  denied: { status: "failed", label: "거부" },
};

const OUTCOME_ITEMS: { value: "" | Outcome; label: string; ariaLabel?: string }[] = [
  { value: "", label: "전체", ariaLabel: "모든 결과" },
  { value: "ok", label: "성공" },
  { value: "error", label: "오류" },
  { value: "denied", label: "거부" },
];

const SELECT =
  "h-9 w-full min-w-0 cursor-pointer rounded-md border border-input bg-surface px-2.5 text-[13px] text-ink shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring max-sm:h-11 max-sm:text-base";
const FIELD = "flex min-w-0 flex-col gap-1 text-xs text-ink-3";

function tokenName(tokens: Map<string, McpTokenView>, id: string | null): string {
  if (!id) return "알 수 없는 토큰";
  return tokens.get(id)?.name ?? "삭제된 토큰";
}

function queryString(filters: Filters, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

// ── Log ──────────────────────────────────────────────────────────────────────

export function McpAuditLog() {
  const { data: session } = useSession();
  const client = useQueryClient();
  const tokens = useMcpTokens();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fieldId = useId();
  const today = toKstCalendarDate(new Date());

  // The tool box is typed into; everything else applies at once.
  const tool = useDebounced(filters.tool.trim(), 300);
  const applied = useMemo(() => ({ ...filters, tool }), [filters, tool]);
  const rangeInvalid = !!applied.from && !!applied.to && applied.from > applied.to;

  const log = useInfiniteQuery<AuditPage>({
    queryKey: [AUDIT_KEY, session?.session.id, applied],
    enabled: !!session && !rangeInvalid,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    queryFn: ({ pageParam, signal }) =>
      mcpFetch<AuditPage>(
        `/api/settings/mcp-tokens/audit?${queryString(applied, pageParam as string | null)}`,
        { signal },
        "감사 로그를 불러오지 못했어요."
      ),
  });

  const tokenMap = useMemo(
    () => new Map((tokens.data ?? []).map((token) => [token.id, token])),
    [tokens.data]
  );
  const items = log.data?.pages.flatMap((page) => page.items) ?? [];
  const toolNames = useMemo(
    () => Array.from(new Set(items.map((item) => item.tool).filter(Boolean) as string[])).sort(),
    [items]
  );
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PanelText>
        MCP 호출은 성공·오류·거부를 가리지 않고 모두 남아요. 인자는 요약만 저장하고, 돌려준 데이터는
        남기지 않아요. 직접 지우기 전까지 보관돼요.
      </PanelText>

      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend className="sr-only">감사 로그 필터</legend>
        <Segmented
          items={OUTCOME_ITEMS}
          value={filters.outcome}
          onChange={(value) => set("outcome", value)}
          ariaLabel="결과"
          fullWidth="mobile"
        />
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
          <label className={FIELD} htmlFor={`${fieldId}-token`}>
            <span>토큰</span>
            <select
              id={`${fieldId}-token`}
              value={filters.tokenId}
              onChange={(event) => set("tokenId", event.target.value)}
              className={SELECT}
            >
              <option value="">모든 토큰</option>
              {(tokens.data ?? []).map((token) => (
                <option key={token.id} value={token.id}>
                  {token.name}
                  {token.status === "active"
                    ? ""
                    : token.status === "revoked"
                      ? " (폐기)"
                      : " (만료)"}
                </option>
              ))}
            </select>
          </label>
          <label className={FIELD} htmlFor={`${fieldId}-tool`}>
            <span>도구</span>
            <Input
              id={`${fieldId}-tool`}
              value={filters.tool}
              list={`${fieldId}-tools`}
              placeholder="예: search_records"
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-[13px] max-sm:h-11"
              onChange={(event) => set("tool", event.target.value)}
            />
            <datalist id={`${fieldId}-tools`}>
              {toolNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <label className={FIELD} htmlFor={`${fieldId}-from`}>
            <span>시작일</span>
            <Input
              id={`${fieldId}-from`}
              type="date"
              max={filters.to || today}
              value={filters.from}
              onChange={(event) => set("from", event.target.value)}
            />
          </label>
          <label className={FIELD} htmlFor={`${fieldId}-to`}>
            <span>종료일</span>
            <Input
              id={`${fieldId}-to`}
              type="date"
              min={filters.from || undefined}
              max={today}
              value={filters.to}
              onChange={(event) => set("to", event.target.value)}
            />
          </label>
        </div>
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            필터 지우기
          </Button>
        ) : null}
        {rangeInvalid ? (
          <p role="alert" className="m-0 text-[13px] text-danger">
            시작일이 종료일보다 늦어요.
          </p>
        ) : null}
      </fieldset>

      {rangeInvalid ? null : log.isPending ? (
        <LoadingState variant="rows" rows={4} label="감사 로그를 불러오는 중" />
      ) : log.isError ? (
        <PanelNote
          tone="danger"
          action={
            <Button variant="outline" size="sm" onClick={() => void log.refetch()}>
              다시 시도
            </Button>
          }
        >
          {userErrorMessage(log.error, "감사 로그를 불러오지 못했어요.")}
        </PanelNote>
      ) : items.length === 0 ? (
        <PanelText className="text-ink-3">
          {filtered ? "조건에 맞는 기록이 없어요." : "아직 MCP 호출 기록이 없어요."}
        </PanelText>
      ) : (
        <div className="min-w-0">
          <table className="w-full table-fixed border-collapse text-left text-[13px] leading-5">
            <caption className="sr-only">MCP 감사 로그, 최신순</caption>
            <thead>
              <tr className="border-b border-line text-xs text-ink-3">
                <th scope="col" className="w-[76px] py-2 pr-2 font-medium sm:w-[132px]">
                  시각
                </th>
                <th scope="col" className="py-2 pr-2 font-medium">
                  도구 · 토큰
                </th>
                <th scope="col" className="w-[100px] py-2 font-medium sm:w-[148px]">
                  결과
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <AuditRow
                  key={entry.id}
                  entry={entry}
                  token={tokenName(tokenMap, entry.tokenId)}
                  open={expanded === entry.id}
                  onToggle={() => setExpanded((id) => (id === entry.id ? null : entry.id))}
                />
              ))}
            </tbody>
          </table>
          {log.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full sm:w-auto"
              disabled={log.isFetchingNextPage}
              onClick={() => void log.fetchNextPage()}
            >
              {log.isFetchingNextPage ? "불러오는 중…" : "더 보기"}
            </Button>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <span className="text-[13px] leading-5 font-semibold text-ink">기록 삭제</span>
        <PanelText>기간이나 토큰을 골라 감사 로그를 지워요. 되돌릴 수 없어요.</PanelText>
        <PanelActions>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:bg-danger-soft hover:text-danger"
            onClick={() => setDeleteOpen(true)}
          >
            기록 삭제…
          </Button>
        </PanelActions>
      </div>

      <DeleteSheet
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        tokens={tokens.data ?? []}
        initial={{ tokenId: filters.tokenId, from: filters.from, to: filters.to }}
        today={today}
        onDeleted={(count) => {
          toast.success(`감사 기록 ${formatCount(count)}건을 지웠어요.`);
          setExpanded(null);
          void client.invalidateQueries({ queryKey: [AUDIT_KEY] });
        }}
      />
    </div>
  );
}

// ── One row ──────────────────────────────────────────────────────────────────

function AuditRow({
  entry,
  token,
  open,
  onToggle,
}: {
  entry: AuditEntry;
  token: string;
  open: boolean;
  onToggle: () => void;
}) {
  const at = new Date(entry.at);
  const badge = OUTCOME_BADGE[entry.outcome] ?? OUTCOME_BADGE.error;
  const detailId = `audit-${entry.id}`;
  const reason =
    entry.outcome === "denied"
      ? denyReasonLabel(entry.denyReason)
      : entry.outcome === "error"
        ? (entry.errorCode ?? "오류")
        : entry.resultCount !== null
          ? `${formatCount(entry.resultCount)}건`
          : null;
  return (
    <Fragment>
      <tr
        className={cn(
          "cursor-pointer border-b border-line align-top transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--sunken)_70%,transparent)] motion-reduce:transition-none",
          open && "bg-sunken"
        )}
        onClick={onToggle}
      >
        <td className="py-2.5 pr-2">
          <time dateTime={entry.at} title={formatDateTime(at)} className="flex flex-col">
            <span className="text-ink-2">{formatMonthDay(at)}</span>
            <span className="num text-xs text-ink-3">{formatTime(at)}</span>
          </time>
        </td>
        <td className="min-w-0 py-2.5 pr-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            className="flex w-full min-w-0 cursor-pointer flex-col items-start border-0 bg-transparent p-0 text-left focus-ring"
          >
            <span className="w-full truncate font-mono text-[13px] text-ink">
              {entry.tool ?? "접속 단계"}
            </span>
            <span className="w-full truncate text-xs text-ink-3">
              {token}
              {/* The address is in the detail; from sm there is room for it here too. */}
              <span className="max-sm:hidden">
                {" · "}
                <span className="font-mono">{entry.ip ?? "IP 미상"}</span>
                {entry.country ? ` · ${entry.country}` : ""}
              </span>
            </span>
          </button>
        </td>
        <td className="py-2.5">
          <div className="flex min-w-0 flex-col items-start gap-0.5">
            <StatusBadge status={badge.status} label={badge.label} />
            {reason ? (
              <span
                className={cn(
                  "max-w-full text-xs leading-4 [overflow-wrap:anywhere]",
                  entry.outcome === "denied" ? "text-ink-2" : "text-ink-3",
                  entry.outcome === "error" && "font-mono"
                )}
              >
                {reason}
                {entry.hitCount > 1 ? ` · ${formatCount(entry.hitCount)}회` : ""}
              </span>
            ) : null}
          </div>
        </td>
      </tr>
      {open ? (
        <tr id={detailId} className="border-b border-line bg-sunken">
          <td colSpan={3} className="px-3 pt-1 pb-3">
            <AuditDetail entry={entry} token={token} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="m-0 max-h-48 min-w-0 overflow-auto rounded-[8px] bg-surface px-3 py-2 font-mono text-xs leading-[18px] whitespace-pre-wrap break-all text-ink-2 shadow-ring">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function AuditDetail({ entry, token }: { entry: AuditEntry; token: string }) {
  const rows: [string, string][] = [
    ["시각", formatDateTime(new Date(entry.at))],
    ["토큰", token],
    ["접속 IP", entry.ip ?? "알 수 없음"],
    ["국가", entry.country ?? "알 수 없음"],
  ];
  if (entry.outcome === "denied") rows.push(["거부 사유", denyReasonLabel(entry.denyReason)]);
  if (entry.errorCode) rows.push(["오류 코드", entry.errorCode]);
  if (entry.resultCount !== null) rows.push(["반환 건수", `${formatCount(entry.resultCount)}건`]);
  if (entry.hitCount > 1 && entry.windowStart) {
    rows.push([
      "묶음",
      `${formatTime(new Date(entry.windowStart))}부터 15분 동안 ${formatCount(entry.hitCount)}회`,
    ]);
  }
  const hasArgs =
    !!entry.argsSummary &&
    typeof entry.argsSummary === "object" &&
    Object.keys(entry.argsSummary as object).length > 0;
  return (
    <div className="ds-reveal flex min-w-0 flex-col gap-3 text-[13px] leading-5">
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-ink-3">{label}</dt>
            <dd className="m-0 text-ink-2 [overflow-wrap:anywhere]">{value}</dd>
          </Fragment>
        ))}
      </dl>
      {hasArgs ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-ink-3">인자 요약 (글은 길이와 해시만)</span>
          <JsonBlock value={entry.argsSummary} />
        </div>
      ) : null}
      {entry.writeBefore || entry.writeAfter ? (
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-ink-3">바꾸기 전</span>
            <JsonBlock value={entry.writeBefore} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-ink-3">바꾼 뒤</span>
            <JsonBlock value={entry.writeAfter} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Delete ───────────────────────────────────────────────────────────────────

function DeleteSheet({
  open,
  onOpenChange,
  tokens,
  initial,
  today,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokens: McpTokenView[];
  initial: { tokenId: string; from: string; to: string };
  today: string;
  onDeleted: (count: number) => void;
}) {
  const [scope, setScope] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const fieldId = useId();

  // Every opening starts from the current filters, unconfirmed.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setScope(initial);
      setConfirming(false);
    }
  }

  const remove = useMutation({
    mutationFn: () =>
      mcpFetch<{ deleted: number }>(
        "/api/settings/mcp-tokens/audit",
        {
          method: "DELETE",
          body: JSON.stringify({
            tokenId: scope.tokenId || undefined,
            from: scope.from || undefined,
            to: scope.to || undefined,
          }),
        },
        "감사 로그를 지우지 못했어요."
      ),
    onSuccess: ({ deleted }) => {
      onDeleted(deleted);
      onOpenChange(false);
    },
    onError: (error) => toast.error(userErrorMessage(error, "감사 로그를 지우지 못했어요.")),
  });

  const hasScope = !!(scope.tokenId || scope.from || scope.to);
  const invalid = !!scope.from && !!scope.to && scope.from > scope.to;
  const tokenLabel = scope.tokenId
    ? `‘${tokens.find((t) => t.id === scope.tokenId)?.name ?? "삭제된 토큰"}’ 토큰의`
    : "모든 토큰의";
  const rangeLabel =
    scope.from && scope.to
      ? `${formatDateRange(scope.from, scope.to)} 사이`
      : scope.from
        ? `${formatMonthDay(scope.from)}부터`
        : scope.to
          ? `${formatMonthDay(scope.to)}까지`
          : "전체 기간";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !remove.isPending && onOpenChange(next)}
      title="감사 기록 삭제"
      description="기간이나 토큰 중 하나 이상을 고르세요. 지운 기록은 되돌릴 수 없어요."
    >
      <div className="flex flex-col gap-3">
        <label className={FIELD} htmlFor={`${fieldId}-token`}>
          <span>토큰</span>
          <select
            id={`${fieldId}-token`}
            value={scope.tokenId}
            disabled={confirming}
            onChange={(event) => setScope((s) => ({ ...s, tokenId: event.target.value }))}
            className={SELECT}
          >
            <option value="">모든 토큰</option>
            {tokens.map((token) => (
              <option key={token.id} value={token.id}>
                {token.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={FIELD} htmlFor={`${fieldId}-from`}>
            <span>시작일</span>
            <Input
              id={`${fieldId}-from`}
              type="date"
              max={scope.to || today}
              value={scope.from}
              disabled={confirming}
              onChange={(event) => setScope((s) => ({ ...s, from: event.target.value }))}
            />
          </label>
          <label className={FIELD} htmlFor={`${fieldId}-to`}>
            <span>종료일</span>
            <Input
              id={`${fieldId}-to`}
              type="date"
              min={scope.from || undefined}
              max={today}
              value={scope.to}
              disabled={confirming}
              onChange={(event) => setScope((s) => ({ ...s, to: event.target.value }))}
            />
          </label>
        </div>
        {invalid ? (
          <p role="alert" className="m-0 text-[13px] text-danger">
            시작일이 종료일보다 늦어요.
          </p>
        ) : null}
        {confirming ? (
          <div className="ds-reveal flex flex-col gap-2.5 rounded-[12px] bg-danger-soft px-3.5 py-3">
            <p className="m-0 text-[13px] leading-5 text-ink">
              {tokenLabel} {rangeLabel} 기록을 지워요. 정말 지울까요?
            </p>
            <PanelActions>
              <Button
                variant="outline"
                size="sm"
                disabled={remove.isPending}
                onClick={() => setConfirming(false)}
              >
                돌아가기
              </Button>
              <Button
                variant="destructive"
                size="sm"
                autoFocus
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? "지우는 중…" : "지우기"}
              </Button>
            </PanelActions>
          </div>
        ) : (
          <PanelActions>
            <Button
              variant="destructive"
              size="sm"
              disabled={!hasScope || invalid}
              onClick={() => setConfirming(true)}
            >
              삭제 범위 확인
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              취소
            </Button>
          </PanelActions>
        )}
      </div>
    </Sheet>
  );
}
