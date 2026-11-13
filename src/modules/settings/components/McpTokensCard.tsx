"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import type { SourceStatus } from "@/components/ds";
import { Disclosure, LoadingState, Segmented, StatusBadge } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/auth-client";
import { shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { formatCount, formatDateTime, formatDay, formatRelative } from "@/lib/format";
import { userErrorMessage } from "@/lib/user-error";
import { cn } from "@/lib/utils";
import { PanelActions, PanelBox, PanelCode, PanelNote, PanelText } from "./panel";

// ── Data ─────────────────────────────────────────────────────────────────────

export type McpScope = "read" | "sensitive-read" | "write";

/** `McpTokenSummary` as it arrives over JSON (dates are ISO strings). */
export interface McpTokenView {
  id: string;
  name: string;
  prefix: string;
  scopes: McpScope[];
  allowedCidrs: string[];
  allowedCountries: string[];
  cidrLockIsCatchAll: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  status: "active" | "revoked" | "expired";
}

interface IssuedToken {
  raw: string;
  token: McpTokenView;
}

export const MCP_TOKENS_KEY = "mcp-tokens";

/** Fetch JSON; a non-2xx answer throws the API's Korean `error` (or `fallback`). */
export async function mcpFetch<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? fallback);
  return body;
}

/** The owner's tokens; shared by the card, the audit log and the 관리 row subtitle. */
export function useMcpTokens(enabled = true) {
  const { data: session } = useSession();
  return useQuery<McpTokenView[]>({
    queryKey: [MCP_TOKENS_KEY, session?.session.id],
    enabled: enabled && !!session,
    queryFn: async ({ signal }) =>
      (
        await mcpFetch<{ tokens: McpTokenView[] }>(
          "/api/settings/mcp-tokens",
          { signal },
          "MCP 토큰을 불러오지 못했어요."
        )
      ).tokens,
  });
}

// ── Labels & lock analysis ───────────────────────────────────────────────────

export const SCOPE_OPTIONS: { value: McpScope; label: string; help: string }[] = [
  {
    value: "read",
    label: "읽기",
    help: "위치·지출·건강·작업·포트폴리오·사진 기록 조회",
  },
  {
    value: "sensitive-read",
    label: "민감 정보 읽기",
    help: "심전도·불규칙 심박, 송금 상대 이름, 계좌명, 원문 알림, 증권 계좌번호",
  },
  {
    value: "write",
    label: "쓰기",
    help: "저장 장소, 거래 분류, 여행 이름·여행 아님 정정",
  },
];

const SCOPE_LABEL: Record<McpScope, string> = {
  read: "읽기",
  "sensitive-read": "민감 정보",
  write: "쓰기",
};

export function scopeText(scopes: readonly McpScope[]): string {
  return scopes.map((scope) => SCOPE_LABEL[scope] ?? scope).join(" · ");
}

const CATCH_ALL = new Set(["0.0.0.0/0", "::/0"]);

export interface LockWarnings {
  /** Neither a real IP range nor a country — anyone holding the token can use it anywhere. */
  noLock: boolean;
  /** Some IP entry is 0.0.0.0/0 or ::/0, which matches every address. */
  catchAll: boolean;
  /** write + sensitive-read on one token: one leak both reads and changes the most. */
  writeWithSensitive: boolean;
}

export function lockWarnings(input: {
  scopes: readonly McpScope[];
  cidrs: readonly string[];
  countries: readonly string[];
}): LockWarnings {
  const catchAll = input.cidrs.some((cidr) => CATCH_ALL.has(cidr.trim()));
  const realCidrs = input.cidrs.filter((cidr) => !CATCH_ALL.has(cidr.trim()));
  return {
    noLock: realCidrs.length === 0 && input.countries.length === 0,
    catchAll,
    writeWithSensitive: input.scopes.includes("write") && input.scopes.includes("sensitive-read"),
  };
}

function lockText(token: McpTokenView): string {
  const parts: string[] = [];
  if (token.allowedCidrs.length > 0) {
    parts.push(
      token.cidrLockIsCatchAll ? "IP 전체 허용" : `IP ${formatCount(token.allowedCidrs.length)}개`
    );
  }
  if (token.allowedCountries.length > 0) parts.push(token.allowedCountries.join(", "));
  return parts.length > 0 ? parts.join(" · ") : "잠금 없음";
}

const EXPIRING_SOON_MS = 7 * 86_400_000;

function tokenBadge(token: McpTokenView, now: Date): { status: SourceStatus; label: string } {
  if (token.status === "revoked") return { status: "disconnected", label: "폐기됨" };
  if (token.status === "expired") return { status: "disconnected", label: "만료됨" };
  if (token.expiresAt && new Date(token.expiresAt).getTime() - now.getTime() < EXPIRING_SOON_MS) {
    return { status: "delayed", label: "곧 만료" };
  }
  return { status: "ok", label: "사용 중" };
}

function splitList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function copyText(text: string, what: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${what}을 복사했어요.`))
    .catch(() => toast.error("복사하지 못했어요. 직접 선택해 복사해 주세요."));
}

// ── Card ─────────────────────────────────────────────────────────────────────

type Confirm = { id: string; action: TokenAction } | null;

export function McpTokensCard() {
  const client = useQueryClient();
  const tokens = useMcpTokens();
  const [now] = useState(() => new Date());
  const [fresh, setFresh] = useState<{ raw: string; name: string; rotated: boolean } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [endpoint] = useState(() =>
    typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`
  );
  const pastId = useId();
  const formId = useId();

  const refresh = () => client.invalidateQueries({ queryKey: [MCP_TOKENS_KEY] });

  const rotate = useMutation({
    mutationFn: (id: string) =>
      mcpFetch<IssuedToken>(
        `/api/settings/mcp-tokens/${id}`,
        { method: "POST", body: JSON.stringify({ action: "rotate" }) },
        "토큰을 다시 만들지 못했어요."
      ),
    onSuccess: (issued) => {
      setFresh({ raw: issued.raw, name: issued.token.name, rotated: true });
      setConfirm(null);
      void refresh();
    },
    onError: (error) => toast.error(userErrorMessage(error, "토큰을 다시 만들지 못했어요.")),
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      mcpFetch<{ revoked: boolean }>(
        `/api/settings/mcp-tokens/${id}`,
        { method: "DELETE" },
        "토큰을 폐기하지 못했어요."
      ),
    onSuccess: () => {
      toast.success("토큰을 폐기했어요. 이 토큰으로 오는 요청은 바로 거부돼요.");
      setConfirm(null);
      void refresh();
    },
    onError: (error) => toast.error(userErrorMessage(error, "토큰을 폐기하지 못했어요.")),
  });

  const list = tokens.data ?? [];
  const active = list.filter((token) => token.status === "active");
  const past = list.filter((token) => token.status !== "active");

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PanelText>
        Claude 같은 에이전트가 MCP로 기록을 읽거나 정정할 수 있게 토큰을 만들어요. 토큰마다 스코프와
        IP·국가 잠금을 따로 정하고, 모든 호출은 감사 로그에 남아요.
      </PanelText>

      <PanelBox title="MCP 엔드포인트">
        <span>
          에이전트에 이 주소와 <code className="font-mono text-xs">Authorization: Bearer 토큰</code>{" "}
          헤더를 설정하세요.
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <PanelCode className="min-w-0 flex-1">{endpoint}</PanelCode>
          <Button variant="outline" size="sm" onClick={() => copyText(endpoint, "주소")}>
            복사
          </Button>
        </div>
      </PanelBox>

      {fresh ? (
        <section
          aria-label="새 토큰"
          className="ds-reveal flex min-w-0 flex-col gap-2.5 rounded-[12px] bg-brand-soft px-4 py-3.5"
        >
          <PanelNote tone="warn">
            {fresh.rotated
              ? `‘${fresh.name}’ 토큰을 새로 만들었어요. 이전 토큰은 이제 작동하지 않아요.`
              : `‘${fresh.name}’ 토큰을 만들었어요.`}{" "}
            이 값은 다시 보여 주지 않으니 지금 복사해 두세요.
          </PanelNote>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <PanelCode className="min-w-0 flex-1 text-ink">{fresh.raw}</PanelCode>
            <PanelActions>
              <Button size="sm" onClick={() => copyText(fresh.raw, "토큰")}>
                토큰 복사
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFresh(null)}>
                복사했어요
              </Button>
            </PanelActions>
          </div>
        </section>
      ) : null}

      {tokens.isPending ? (
        <LoadingState variant="rows" rows={2} label="MCP 토큰을 불러오는 중" />
      ) : tokens.isError ? (
        <PanelNote
          tone="danger"
          action={
            <Button variant="outline" size="sm" onClick={() => void tokens.refetch()}>
              다시 시도
            </Button>
          }
        >
          {userErrorMessage(tokens.error, "MCP 토큰을 불러오지 못했어요.")}
        </PanelNote>
      ) : active.length === 0 ? (
        <PanelText className="text-ink-3">
          사용 중인 토큰이 없어요. 아래에서 첫 토큰을 만들어 보세요.
        </PanelText>
      ) : (
        <ul aria-label="사용 중인 MCP 토큰" className="m-0 list-none border-t border-line p-0">
          {active.map((token) => (
            <TokenRow
              key={token.id}
              token={token}
              now={now}
              confirm={confirm?.id === token.id ? confirm.action : null}
              busy={
                (rotate.isPending && rotate.variables === token.id) ||
                (revoke.isPending && revoke.variables === token.id)
              }
              onAsk={(action) => setConfirm({ id: token.id, action })}
              onCancel={() => setConfirm(null)}
              onConfirm={(action) =>
                action === "rotate" ? rotate.mutate(token.id) : revoke.mutate(token.id)
              }
            />
          ))}
        </ul>
      )}

      {past.length > 0 ? (
        <div className="flex flex-col">
          <button
            type="button"
            aria-expanded={showPast}
            aria-controls={pastId}
            onClick={() => setShowPast((v) => !v)}
            className="flex min-h-11 cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-[13px] font-medium text-ink-2 hover:text-ink focus-ring sm:min-h-9"
          >
            폐기·만료된 토큰 {formatCount(past.length)}개
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className={cn(
                "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                showPast && "rotate-180"
              )}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
          <Disclosure open={showPast} id={pastId}>
            <ul
              aria-label="폐기·만료된 MCP 토큰"
              className="m-0 list-none border-t border-line p-0"
            >
              {past.map((token) => (
                <TokenRow key={token.id} token={token} now={now} />
              ))}
            </ul>
          </Disclosure>
        </div>
      ) : null}

      {formOpen ? (
        <IssueForm
          id={formId}
          onCancel={() => setFormOpen(false)}
          onIssued={(issued) => {
            setFresh({ raw: issued.raw, name: issued.token.name, rotated: false });
            setFormOpen(false);
            void refresh();
          }}
        />
      ) : (
        <PanelActions>
          <Button size="sm" onClick={() => setFormOpen(true)} aria-controls={formId}>
            새 토큰 만들기
          </Button>
        </PanelActions>
      )}
    </div>
  );
}

// ── One token ────────────────────────────────────────────────────────────────

type TokenAction = "rotate" | "revoke";

const WARNING_COPY = {
  noLock: "IP나 국가 잠금이 없어요. 토큰이 새면 어디서든 쓸 수 있어요.",
  catchAll: "0.0.0.0/0, ::/0은 모든 주소와 맞아서 잠금으로 치지 않아요.",
  writeWithSensitive:
    "쓰기와 민감 정보 읽기를 한 토큰에 함께 주면, 토큰 하나가 새도 가장 많이 읽고 바꿀 수 있어요.",
} as const satisfies Record<keyof LockWarnings, string>;

/** The lock/scope warnings that apply, one quiet warn note each (nothing when none apply). */
function TokenWarnings({ warn, live = false }: { warn: LockWarnings; live?: boolean }) {
  const keys = (Object.keys(WARNING_COPY) as (keyof LockWarnings)[]).filter((key) => warn[key]);
  if (keys.length === 0 && !live) return null;
  return (
    <div className="flex flex-col gap-1.5 empty:hidden" aria-live={live ? "polite" : undefined}>
      {keys.map((key) => (
        <PanelNote key={key} tone="warn">
          {WARNING_COPY[key]}
        </PanelNote>
      ))}
    </div>
  );
}

function expiryText(token: McpTokenView, now: Date): string {
  if (token.status === "revoked" && token.revokedAt) {
    return formatDay(new Date(token.revokedAt), { now });
  }
  return token.expiresAt ? formatDateTime(new Date(token.expiresAt), { now }) : "만료 없음";
}

function TokenFacts({ token, now, noLock }: { token: McpTokenView; now: Date; noLock: boolean }) {
  const lastUsed = token.lastUsedAt ? new Date(token.lastUsedAt) : null;
  const showCidrs = token.allowedCidrs.length > 0 && !token.cidrLockIsCatchAll;
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[13px] leading-5">
      <dt className="text-ink-3">스코프</dt>
      <dd className="m-0 text-ink-2">{scopeText(token.scopes)}</dd>
      <dt className="text-ink-3">잠금</dt>
      <dd className={cn("m-0 [overflow-wrap:anywhere]", noLock ? "text-warn" : "text-ink-2")}>
        {lockText(token)}
        {showCidrs ? (
          <span className="block font-mono text-xs break-all text-ink-3">
            {token.allowedCidrs.join(", ")}
          </span>
        ) : null}
      </dd>
      <dt className="text-ink-3">마지막 사용</dt>
      <dd className="m-0 text-ink-2">
        {lastUsed ? (
          <time dateTime={token.lastUsedAt ?? undefined} title={formatDateTime(lastUsed)}>
            {formatRelative(lastUsed, now)}
          </time>
        ) : (
          "아직 없음"
        )}
      </dd>
      <dt className="text-ink-3">{token.status === "revoked" ? "폐기" : "만료"}</dt>
      <dd className="m-0 text-ink-2">{expiryText(token, now)}</dd>
    </dl>
  );
}

const CONFIRM_COPY: Record<TokenAction, { label: string; text: string; confirm: string }> = {
  rotate: {
    label: "토큰 다시 만들기 확인",
    text: "같은 설정으로 새 토큰을 만들고, 지금 토큰은 바로 작동을 멈춰요. 에이전트 설정도 새 값으로 바꿔야 해요.",
    confirm: "새 토큰 만들기",
  },
  revoke: {
    label: "토큰 폐기 확인",
    text: "이 토큰은 바로 작동을 멈추고 되돌릴 수 없어요. 감사 로그는 남아요.",
    confirm: "폐기하기",
  },
};

/** Inline second step for rotate/revoke (no window.confirm, no modal). */
function ConfirmStrip({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: TokenAction;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = CONFIRM_COPY[action];
  return (
    <fieldset
      aria-label={copy.label}
      className="ds-reveal m-0 flex min-w-0 flex-col gap-2.5 rounded-[12px] border-0 bg-sunken px-3.5 py-3"
    >
      <p className="m-0 text-[13px] leading-5 text-ink">{copy.text}</p>
      <PanelActions>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          취소
        </Button>
        <Button
          size="sm"
          variant={action === "revoke" ? "destructive" : "default"}
          onClick={onConfirm}
          disabled={busy}
          autoFocus
        >
          {busy ? "처리 중…" : copy.confirm}
        </Button>
      </PanelActions>
    </fieldset>
  );
}

function TokenRow({
  token,
  now,
  confirm = null,
  busy = false,
  onAsk,
  onCancel,
  onConfirm,
}: {
  token: McpTokenView;
  now: Date;
  confirm?: TokenAction | null;
  busy?: boolean;
  onAsk?: (action: TokenAction) => void;
  onCancel?: () => void;
  onConfirm?: (action: TokenAction) => void;
}) {
  const badge = tokenBadge(token, now);
  const live = token.status === "active";
  const warn = lockWarnings({
    scopes: token.scopes,
    cidrs: token.allowedCidrs,
    countries: token.allowedCountries,
  });
  return (
    <li
      className={cn("flex min-w-0 flex-col gap-2 border-b border-line py-3", !live && "opacity-70")}
      data-testid="mcp-token-row"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm leading-5 font-semibold text-ink [overflow-wrap:anywhere]">
            {token.name}
          </span>
          <span className="font-mono text-xs leading-[18px] break-all text-ink-3">
            {token.prefix}
          </span>
        </div>
        <StatusBadge status={badge.status} label={badge.label} />
      </div>
      <TokenFacts token={token} now={now} noLock={warn.noLock} />
      {live ? <TokenWarnings warn={warn} /> : null}
      {live && onAsk && confirm ? (
        <ConfirmStrip
          action={confirm}
          busy={busy}
          onCancel={() => onCancel?.()}
          onConfirm={() => onConfirm?.(confirm)}
        />
      ) : null}
      {live && onAsk && !confirm ? (
        <PanelActions>
          <Button variant="outline" size="sm" onClick={() => onAsk("rotate")}>
            다시 만들기
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAsk("revoke")}
            className="text-danger hover:bg-danger-soft hover:text-danger"
          >
            폐기
          </Button>
        </PanelActions>
      ) : null}
    </li>
  );
}

// ── Issue form ───────────────────────────────────────────────────────────────

type ExpiryPreset = "none" | "30" | "90" | "365" | "custom";

const EXPIRY_ITEMS: { value: ExpiryPreset; label: string; ariaLabel?: string }[] = [
  { value: "none", label: "없음", ariaLabel: "만료 없음" },
  { value: "30", label: "30일" },
  { value: "90", label: "90일" },
  { value: "365", label: "1년" },
  { value: "custom", label: "직접", ariaLabel: "날짜 직접 고르기" },
];

const FIELD_LABEL = "flex flex-col gap-1.5 text-[13px] leading-5 font-medium text-ink";
const FIELD_HELP = "text-xs leading-[18px] font-normal text-ink-3";
const TEXTAREA =
  "min-h-[72px] w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-[13px] leading-5 text-ink shadow-xs outline-none placeholder:text-ink-3 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring max-sm:text-base";

function expiryInstant(preset: ExpiryPreset, customDate: string, now: Date): string | null {
  if (preset === "none") return null;
  if (preset === "custom") return customDate ? `${customDate}T23:59:59+09:00` : null;
  return new Date(now.getTime() + Number(preset) * 86_400_000).toISOString();
}

function IssueForm({
  id,
  onCancel,
  onIssued,
}: {
  id: string;
  onCancel: () => void;
  onIssued: (issued: IssuedToken) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<McpScope[]>(["read"]);
  const [cidrText, setCidrText] = useState("");
  const [countryText, setCountryText] = useState("KR");
  const [expiry, setExpiry] = useState<ExpiryPreset>("90");
  const [customDate, setCustomDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const tomorrow = shiftDateKey(toKstCalendarDate(new Date()), 1);

  const cidrs = splitList(cidrText);
  const countries = splitList(countryText).map((code) => code.toUpperCase());
  const warn = lockWarnings({ scopes, cidrs, countries });

  const issue = useMutation({
    mutationFn: () =>
      mcpFetch<IssuedToken>(
        "/api/settings/mcp-tokens",
        {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            scopes,
            allowedCidrs: cidrs,
            allowedCountries: countries,
            expiresAt: expiryInstant(expiry, customDate, new Date()),
          }),
        },
        "토큰을 만들지 못했어요."
      ),
    onSuccess: onIssued,
    onError: (err) => setError(userErrorMessage(err, "토큰을 만들지 못했어요.")),
  });

  const toggleScope = (scope: McpScope, on: boolean) =>
    setScopes((prev) =>
      on
        ? SCOPE_OPTIONS.map((o) => o.value).filter((v) => v === scope || prev.includes(v))
        : prev.filter((v) => v !== scope)
    );

  const canSubmit =
    name.trim().length > 0 &&
    scopes.length > 0 &&
    (expiry !== "custom" || customDate !== "") &&
    !issue.isPending;

  return (
    <form
      id={id}
      aria-label="새 MCP 토큰"
      className="ds-reveal flex min-w-0 flex-col gap-4 rounded-[14px] px-4 py-4 shadow-ring"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (canSubmit) issue.mutate();
      }}
    >
      <span className="text-sm leading-5 font-semibold text-ink">새 토큰</span>

      <label className={FIELD_LABEL} htmlFor={`${fieldId}-name`}>
        이름
        <Input
          id={`${fieldId}-name`}
          value={name}
          maxLength={60}
          placeholder="예: 노트북 Claude"
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
        <legend className="mb-1.5 p-0 text-[13px] leading-5 font-medium text-ink">스코프</legend>
        {SCOPE_OPTIONS.map((option) => {
          const checked = scopes.includes(option.value);
          return (
            <label
              key={option.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] px-2.5 py-2 transition-colors duration-150 hover:bg-sunken motion-reduce:transition-none",
                checked && "bg-sunken"
              )}
            >
              <input
                type="checkbox"
                name="scopes"
                value={option.value}
                checked={checked}
                onChange={(event) => toggleScope(option.value, event.target.checked)}
                className="mt-0.5 size-4 flex-none cursor-pointer accent-[var(--brand)]"
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] leading-5 font-medium text-ink">{option.label}</span>
                <span className={FIELD_HELP}>{option.help}</span>
              </span>
            </label>
          );
        })}
        {scopes.length === 0 ? (
          <span className="pl-2.5 text-xs text-danger">스코프를 하나 이상 고르세요.</span>
        ) : null}
      </fieldset>

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className={FIELD_LABEL} htmlFor={`${fieldId}-cidrs`}>
          허용 IP 범위
          <span className={FIELD_HELP}>한 줄에 하나, 비우면 IP 제한 없음</span>
          <textarea
            id={`${fieldId}-cidrs`}
            value={cidrText}
            spellCheck={false}
            placeholder={"203.0.113.0/24\n2001:db8::/48"}
            onChange={(event) => setCidrText(event.target.value)}
            className={TEXTAREA}
          />
        </label>
        <label className={FIELD_LABEL} htmlFor={`${fieldId}-countries`}>
          허용 국가
          <span className={FIELD_HELP}>ISO 두 글자 코드, 쉼표로 구분</span>
          <Input
            id={`${fieldId}-countries`}
            value={countryText}
            spellCheck={false}
            autoCapitalize="characters"
            placeholder="KR, JP"
            className="font-mono"
            onChange={(event) => setCountryText(event.target.value)}
          />
        </label>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-5 font-medium text-ink" id={`${fieldId}-exp`}>
          만료
        </span>
        <Segmented
          items={EXPIRY_ITEMS}
          value={expiry}
          onChange={setExpiry}
          ariaLabel="만료"
          fullWidth="mobile"
        />
        {expiry === "custom" ? (
          <Input
            type="date"
            aria-labelledby={`${fieldId}-exp`}
            min={tomorrow}
            value={customDate}
            onChange={(event) => setCustomDate(event.target.value)}
            className="ds-reveal sm:max-w-[200px]"
          />
        ) : null}
      </div>

      <TokenWarnings warn={warn} live />

      {error ? (
        <p role="alert" className="m-0 text-[13px] leading-5 text-danger">
          {error}
        </p>
      ) : null}

      <PanelActions>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {issue.isPending ? "만드는 중…" : "토큰 만들기"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          취소
        </Button>
      </PanelActions>
    </form>
  );
}
