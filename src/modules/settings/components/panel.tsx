/**
 * Building blocks for the bodies of settings disclosure rows, so every panel
 * shares one rhythm: 13/20 ink-2 copy, hairline stat rows instead of tinted
 * tiles, quiet notes with a status dot instead of colored boxes.
 */
import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PanelText({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("m-0 text-[13px] leading-5 text-ink-2", className)}>{children}</p>;
}

/** A one-line status note: dot + text. `warn` for something to act on. */
export function PanelNote({
  tone = "ink",
  children,
  action,
}: {
  tone?: "ink" | "warn" | "gain" | "brand";
  children: ReactNode;
  action?: ReactNode;
}) {
  const dot =
    tone === "warn"
      ? "bg-warn"
      : tone === "gain"
        ? "bg-gain"
        : tone === "brand"
          ? "bg-brand"
          : "bg-ink-3";
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 flex items-start gap-2 text-[13px] leading-5 text-ink">
        <span aria-hidden="true" className={cn("mt-[7px] size-1.5 flex-none rounded-full", dot)} />
        <span>{children}</span>
      </p>
      {action ? <div className="flex flex-wrap gap-2 pl-3.5">{action}</div> : null}
    </div>
  );
}

/** Inset block for setup guides and endpoints. */
export function PanelBox({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-[12px] bg-sunken px-4 py-3.5 text-[13px] leading-5 text-ink-2">
      {title ? <span className="font-semibold text-ink">{title}</span> : null}
      {children}
    </div>
  );
}

/** Monospace value (keys, URLs) that wraps instead of overflowing. */
export function PanelCode({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      className={cn(
        "block min-w-0 rounded-[8px] bg-surface px-3 py-2 font-mono text-xs leading-[18px] break-all text-ink-2 shadow-ring",
        className
      )}
    >
      {children}
    </code>
  );
}

export interface PanelStat {
  label: string;
  /** Numbers are grouped (12,581); strings render as given. */
  value: number | string;
  unit?: string;
  tone?: "ink" | "warn" | "gain" | "muted";
}

/** Hairline row of figures (2 per line on phones, up to 4 from sm). */
export function PanelStats({ items }: { items: PanelStat[] }) {
  return (
    <dl
      className={cn(
        "m-0 grid grid-cols-2 border-y border-line",
        items.length >= 4 ? "sm:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : ""
      )}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          className={cn(
            "flex flex-col gap-0.5 py-3",
            i % 2 === 1 ? "border-l border-line pl-4" : "pr-4",
            i >= 2 && "border-t border-line sm:border-t-0",
            i >= 1 && items.length >= 3 && "sm:border-l sm:border-line sm:pl-4"
          )}
        >
          <dt className="text-label">{item.label}</dt>
          <dd
            className={cn(
              "m-0 num text-lg leading-6 font-medium",
              item.tone === "warn"
                ? "text-warn"
                : item.tone === "gain"
                  ? "text-gain"
                  : item.tone === "muted"
                    ? "text-ink-3"
                    : "text-ink"
            )}
          >
            {typeof item.value === "number" ? formatCount(item.value) : item.value}
            {item.unit ? (
              <span className="ml-0.5 font-sans text-xs text-ink-3">{item.unit}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A labelled on/off row: 36×22 track (brand when on) inside a ≥44px tall
 * label, so the whole line is the hit area.
 */
export function PanelSwitch({
  id,
  checked,
  disabled,
  onCheckedChange,
  children,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex min-h-11 cursor-pointer items-center gap-2.5 self-start text-[13px] leading-5 text-ink-2 sm:min-h-9",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="inline-flex h-[22px] w-9 flex-none cursor-[inherit] items-center rounded-full border-0 bg-[color-mix(in_oklab,var(--ink)_24%,var(--track))] p-0.5 transition-colors duration-150 ease-out focus-ring data-[state=checked]:bg-brand"
      >
        <SwitchPrimitive.Thumb className="pointer-events-none block size-[18px] rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.18),0_0_0_0.5px_rgb(0_0_0/0.06)] transition-transform duration-150 ease-out data-[state=checked]:translate-x-3.5" />
      </SwitchPrimitive.Root>
      {children}
    </label>
  );
}

/** Rows of a panel list: hairline separated, flush with the panel text. */
export function PanelList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="m-0 list-none border-t border-line p-0">
      {children}
    </ul>
  );
}

export function PanelListItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <li className={cn("flex items-start gap-3 border-b border-line py-3", className)}>
      {children}
    </li>
  );
}

/** 36px (44px on phones) quiet icon button for row actions. */
export function PanelIconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid size-9 flex-none cursor-pointer place-items-center rounded-[9px] border-0 bg-transparent transition-[background-color,color,scale] duration-150 ease-out focus-ring active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 max-sm:size-11 [&_svg]:size-[15px]",
        danger
          ? "text-ink-3 hover:bg-gain-soft hover:text-gain"
          : "text-ink-2 hover:bg-track hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

export function PanelActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function copy(text: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success("클립보드에 복사했어요."))
    .catch(() => toast.error("복사하지 못했어요. 직접 선택해 복사해 주세요."));
}

/**
 * Shared body for the API-key ingestion connections (OwnTracks, 토스 알림,
 * Health Connect): key state, regenerate/delete, and the endpoint guide.
 */
export function ApiKeyPanel({
  description,
  hasKey,
  newKey,
  prefix,
  isGenerating,
  isRevoking,
  onGenerate,
  onRevoke,
  endpoint,
  guideTitle,
  guide,
  children,
}: {
  description: ReactNode;
  hasKey: boolean;
  newKey: string | null;
  /** Masked-key prefix, e.g. `ot_`. */
  prefix: string;
  isGenerating: boolean;
  isRevoking: boolean;
  onGenerate: () => void;
  onRevoke: () => void;
  /** Endpoint without the key, ending in `apikey=`. */
  endpoint: string;
  guideTitle: string;
  guide: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PanelText>{description}</PanelText>
      {!hasKey ? (
        <PanelActions>
          <Button size="sm" onClick={onGenerate} disabled={isGenerating}>
            {isGenerating ? "만드는 중…" : "API 키 만들기"}
          </Button>
        </PanelActions>
      ) : (
        <div className="flex flex-col gap-2.5">
          {newKey ? (
            <>
              <PanelNote tone="warn">이 키는 다시 보여 주지 않아요. 지금 복사해 두세요.</PanelNote>
              <div className="flex items-center gap-2">
                <PanelCode className="flex-1 text-ink">{newKey}</PanelCode>
                <Button variant="outline" size="sm" onClick={() => copy(newKey)}>
                  키 복사
                </Button>
              </div>
            </>
          ) : (
            <PanelCode className="text-ink-3">{prefix}•••••••••••••••••••••••••</PanelCode>
          )}
          <PanelActions>
            <Button variant="outline" size="sm" onClick={onGenerate} disabled={isGenerating}>
              {isGenerating ? "만드는 중…" : "키 다시 만들기"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRevoke}
              disabled={isRevoking}
              className="text-gain hover:bg-gain-soft hover:text-gain"
            >
              {isRevoking ? "삭제 중…" : "키 삭제"}
            </Button>
          </PanelActions>
        </div>
      )}
      {children}
      <PanelBox title={guideTitle}>
        {guide}
        <div className="flex items-center gap-2">
          <PanelCode className="flex-1">
            {endpoint}
            {newKey ?? "YOUR_KEY"}
          </PanelCode>
          {newKey ? (
            <Button variant="outline" size="sm" onClick={() => copy(`${endpoint}${newKey}`)}>
              URL 복사
            </Button>
          ) : null}
        </div>
      </PanelBox>
    </div>
  );
}

/** Shared body for OAuth connections (Google Health, Withings). */
export function OAuthPanel({
  description,
  connected,
  needsReauth,
  authorizeHref,
  providerName,
  stats,
  extraActions,
  isDisconnecting,
  onDisconnect,
}: {
  description: ReactNode;
  connected: boolean;
  needsReauth: boolean;
  authorizeHref: string;
  providerName: string;
  stats?: PanelStat[];
  extraActions?: ReactNode;
  isDisconnecting: boolean;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PanelText>{description}</PanelText>
      {!connected ? (
        <PanelActions>
          {/* Full-page redirect into the OAuth flow (authorize → consent → callback). */}
          <Button size="sm" asChild>
            <a href={authorizeHref}>{providerName} 연결</a>
          </Button>
        </PanelActions>
      ) : (
        <>
          {needsReauth ? (
            <PanelNote
              tone="warn"
              action={
                <Button size="sm" asChild>
                  <a href={authorizeHref}>{providerName} 다시 연결</a>
                </Button>
              }
            >
              {providerName} 인증이 만료됐어요. 다시 연결하면 동기화가 이어지고, 이미 가져온 기록은
              그대로예요.
            </PanelNote>
          ) : null}
          {stats ? <PanelStats items={stats} /> : null}
          <PanelActions>
            {extraActions}
            <Button
              variant="ghost"
              size="sm"
              onClick={onDisconnect}
              disabled={isDisconnecting}
              className="text-gain hover:bg-gain-soft hover:text-gain"
            >
              {isDisconnecting ? "해제 중…" : "연결 해제"}
            </Button>
          </PanelActions>
        </>
      )}
    </div>
  );
}
