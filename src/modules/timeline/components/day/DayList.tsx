"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AiLine, FactTrigger, RowFlag, useEvidence } from "@/components/ds";
import { cn } from "@/lib/utils";
import {
  type CommitClusterRow,
  type DayRow,
  type IncomeRow,
  type RideRow,
  routeLabel,
  type SleepRow,
  type StayRow,
  type TxRow,
} from "../../day-model";

export interface DayListProps {
  rows: DayRow[];
  selectedId: string | null;
  /** Map target of the selection (a child row highlights its stay too). */
  selectedMapId: string | null;
  onSelect: (id: string) => void;
  /** Altitude series per ride id, for the expanded ride's profile. */
  altitudes: Record<string, number[]>;
  /** Scroll the selected row into view (selection came from the map/strip). */
  scrollKey: number;
  compact?: boolean;
}

/**
 * The day as compact timeline rows: places and rides at the top level, commits,
 * payments and sleep indented under the place they happened at. Selection is
 * shared with the map and the 24h strip; AI-line evidence dims unrelated rows.
 */
export function DayList({
  rows,
  selectedId,
  selectedMapId,
  onSelect,
  altitudes,
  scrollKey,
  compact = false,
}: DayListProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [flag, setFlag] = useState<string | null>(null);
  const { stateOf } = useEvidence();
  const refs = useRef(new Map<string, HTMLElement>());

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrollKey is the trigger
  useEffect(() => {
    if (!selectedId || scrollKey === 0) return;
    const el = refs.current.get(selectedId);
    const scroller = el?.closest<HTMLElement>("[data-day-scroll]");
    if (!el || !scroller || scroller.scrollHeight <= scroller.clientHeight) return;
    const top = el.offsetTop - scroller.offsetTop;
    const visible =
      top >= scroller.scrollTop &&
      top + el.offsetHeight <= scroller.scrollTop + scroller.clientHeight;
    if (!visible) scroller.scrollTo({ top: Math.max(0, top - 24), behavior: "smooth" });
  }, [scrollKey]);

  const toggle = (id: string) => {
    setOpen((o) => ({ ...o, [id]: !o[id] }));
    onSelect(id);
  };

  return (
    <ol className="m-0 list-none p-0">
      {rows.map((row) => {
        const ev = stateOf(row.id);
        const selected = selectedId === row.id || (row.depth === 0 && selectedMapId === row.id);
        const flagProps = row.flag
          ? {
              flag: row.flag,
              flagOpen: flag === row.id,
              onFlag: (next: boolean) => setFlag(next ? row.id : null),
            }
          : null;
        return (
          <li
            key={row.id}
            ref={(el) => {
              if (el) refs.current.set(row.id, el);
              else refs.current.delete(row.id);
            }}
            data-evidence={ev}
            className={cn(
              "grid grid-cols-[var(--tc)_22px_minmax(0,1fr)] items-start gap-x-2.5 transition-opacity duration-150",
              compact ? "[--tc:44px]" : "[--tc:48px]"
            )}
          >
            <span
              className={cn(
                "num pt-2.5 text-right leading-[22px]",
                row.depth === 0 ? "text-[13px] font-medium text-ink-2" : "text-xs text-ink-3"
              )}
            >
              {row.time}
            </span>
            <Rail row={row} />
            <div
              className={cn(
                "my-0.5 min-w-0 rounded-[10px] px-2.5 pt-2 pb-2.5 transition-colors duration-150",
                selected || ev === "on" ? "bg-brand-soft" : "hover:bg-track"
              )}
            >
              {row.kind === "stay" ? (
                <StayBody row={row} onSelect={onSelect} selected={selected} />
              ) : row.kind === "ride" ? (
                <RideBody
                  row={row}
                  open={!!open[row.id]}
                  onToggle={() => toggle(row.id)}
                  altitudes={altitudes[row.id]}
                  compact={compact}
                  {...flagProps}
                />
              ) : row.kind === "commits" ? (
                <CommitBody row={row} open={!!open[row.id]} onToggle={() => toggle(row.id)} />
              ) : row.kind === "tx" ? (
                <TxBody row={row} onSelect={onSelect} {...flagProps} />
              ) : row.kind === "income" ? (
                <IncomeBody row={row} onSelect={onSelect} />
              ) : (
                <SleepBody
                  row={row}
                  open={!!open[row.id]}
                  onToggle={() => toggle(row.id)}
                  compact={compact}
                  {...flagProps}
                />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── rail ─────────────────────────────────────────────────────────────────────

function Rail({ row }: { row: DayRow }) {
  // A stay the ride's track passed through sits on the ride's dashed rail.
  const stop = row.kind === "stay" && !!row.via;
  const dot =
    row.kind === "stay"
      ? stop
        ? "mt-[14px] size-[9px] bg-page shadow-[0_0_0_1.5px_var(--place)]"
        : "mt-[15px] size-[11px] bg-page shadow-[0_0_0_2px_var(--ink)]"
      : row.kind === "ride"
        ? "mt-4 size-[7px] bg-place shadow-[0_0_0_3px_var(--bg)]"
        : row.kind === "commits"
          ? "mt-4 size-[7px] bg-brand shadow-[0_0_0_3px_var(--bg)]"
          : row.kind === "sleep"
            ? "mt-4 size-[7px] bg-health shadow-[0_0_0_3px_var(--bg)]"
            : "mt-4 size-[7px] bg-ink-2 shadow-[0_0_0_3px_var(--bg)]";
  return (
    <span aria-hidden="true" className="relative flex justify-center self-stretch">
      <span
        className={cn(
          "absolute inset-y-0 left-1/2",
          row.kind === "ride" || row.onRide
            ? "-ml-px border-l-2 border-dashed border-[color-mix(in_oklab,var(--place)_70%,transparent)]"
            : "-ml-[0.5px] w-px bg-line"
        )}
      />
      <i className={cn("relative block rounded-full", dot)} />
    </span>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────

const headClass =
  "relative flex w-full flex-wrap items-baseline gap-x-2 border-0 bg-transparent p-0 text-left focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

function Name({ children, depth }: { children: ReactNode; depth: 0 | 1 }) {
  return (
    <span
      className={cn(
        "leading-[22px] font-semibold text-ink",
        depth === 0 ? "text-[15px]" : "text-sm"
      )}
    >
      {children}
    </span>
  );
}

function Chevron() {
  return (
    <ChevronDown
      aria-hidden="true"
      strokeWidth={2.2}
      className="absolute top-1 right-0 size-3.5 text-ink-3 transition-[rotate] duration-150 group-aria-expanded:rotate-180"
    />
  );
}

interface FlagProps {
  flag?: { label: string; reason: string };
  flagOpen?: boolean;
  onFlag?: (open: boolean) => void;
}

function Flag({ flag, flagOpen, onFlag }: FlagProps) {
  if (!flag || !onFlag) return null;
  return <RowFlag label={flag.label} open={!!flagOpen} onOpenChange={onFlag} />;
}

function FlagReason({ flag, flagOpen }: FlagProps) {
  if (!flag || !flagOpen) return null;
  return (
    <p className="ds-reveal mt-1.5 border-l-2 border-warn pl-2.5 text-xs leading-[18px] text-ink-2">
      {flag.reason}
    </p>
  );
}

// ── bodies ───────────────────────────────────────────────────────────────────

function StayBody({
  row,
  onSelect,
  selected,
}: {
  row: StayRow;
  onSelect: (id: string) => void;
  selected: boolean;
}) {
  return (
    <>
      <button
        type="button"
        className={headClass}
        aria-pressed={selected}
        aria-label={`${row.name} 지도에서 보기`}
        onClick={() => onSelect(row.id)}
      >
        <Name depth={row.via ? 1 : 0}>{row.name}</Name>
        <span className="num text-[13px] text-ink-2">{row.durationLabel}</span>
        {row.via ? <span className="text-xs text-ink-3">경유</span> : null}
      </button>
      <p className="m-0 mt-0.5 text-[13px] leading-5 text-ink-2">
        <span className="num text-xs">{row.range}</span>
        {row.area ? ` · ${row.area}` : null}
      </p>
    </>
  );
}

function RideBody({
  row,
  open,
  onToggle,
  altitudes,
  compact,
  ...flag
}: {
  row: RideRow;
  open: boolean;
  onToggle: () => void;
  altitudes?: number[];
  compact: boolean;
} & FlagProps) {
  const profile =
    altitudes && altitudes.length > 1 ? elevationPath(altitudes, compact ? 220 : 260, 36) : null;
  return (
    <>
      <button
        type="button"
        className={cn(headClass, "group pr-6")}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Name depth={0}>{row.mode}</Name>
        <span className="num text-[13px] text-ink-2">
          {row.distance} · {row.duration}
        </span>
        <Chevron />
      </button>
      {routeLabel(row.from, row.to) ? (
        <p className="m-0 mt-0.5 text-[13px] leading-5 text-ink-2">
          {routeLabel(row.from, row.to)}
          {row.stops.length > 0 ? (
            <span className="text-ink-3"> · 경유 {row.stops.length}곳</span>
          ) : null}
        </p>
      ) : null}
      {flag.flag ? (
        <div className="mt-1.5">
          <Flag {...flag} />
        </div>
      ) : null}
      <FlagReason {...flag} />
      {open ? (
        <div className="ds-reveal mt-2 flex flex-col">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pb-2 text-xs text-ink-2">
            {row.avg ? (
              <span>
                <span className="text-[11px] text-ink-3">평균</span>{" "}
                <span className="num">{row.avg}</span>
              </span>
            ) : null}
            <span>
              <span className="text-[11px] text-ink-3">시간</span>{" "}
              <span className="num">{row.range}</span>
            </span>
            {row.elevation ? (
              <span>
                <span className="text-[11px] text-ink-3">고도</span>{" "}
                <span className="num">
                  ↑{row.elevation.up}m ↓{row.elevation.down}m
                </span>
              </span>
            ) : null}
          </div>
          {profile ? (
            <svg
              role="img"
              aria-label="고도 변화"
              width={profile.w}
              height={profile.h}
              viewBox={`0 0 ${profile.w} ${profile.h}`}
              className="mb-2 block max-w-full"
            >
              <path
                d={profile.d}
                fill="none"
                stroke="var(--place)"
                strokeWidth={1.6}
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
          {row.legs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pb-2">
              {row.legs.map((l) => (
                <span
                  key={l}
                  className="inline-flex h-[22px] items-center rounded-full bg-sunken px-2 text-xs text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]"
                >
                  {l}
                </span>
              ))}
            </div>
          ) : null}
          {row.segments.map((g, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_64px_76px_72px] gap-2.5 border-t border-line py-1.5 text-[13px]"
            >
              <span>{g.mode}</span>
              <span className="num text-right text-xs text-ink-2">{g.distance}</span>
              <span className="num text-right text-xs text-ink-2">{g.duration}</span>
              <span className="num text-right text-xs text-ink-2">{g.avg}</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

function elevationPath(alt: number[], w: number, h: number) {
  // Downsample to at most one point per 2px so the path stays light.
  const step = Math.max(1, Math.floor(alt.length / (w / 2)));
  const pts = alt.filter((_, i) => i % step === 0);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const d = pts
    .map(
      (a, i) =>
        `${i ? "L" : "M"}${((i / Math.max(1, pts.length - 1)) * w).toFixed(1)} ${(h - 2 - ((a - lo) / Math.max(1, hi - lo)) * (h - 6)).toFixed(1)}`
    )
    .join("");
  return { d, w, h };
}

function CommitBody({
  row,
  open,
  onToggle,
}: {
  row: CommitClusterRow;
  open: boolean;
  onToggle: () => void;
}) {
  const rest = row.count - 1;
  return (
    <>
      <button
        type="button"
        className={cn(headClass, "group pr-6")}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Name depth={1}>커밋 {row.count}</Name>
        <span className="num text-xs text-ink-2">{row.range}</span>
        <span className="text-xs text-ink-3">{row.repo}</span>
        <Chevron />
      </button>
      {row.summary ? (
        <AiLine className="mt-0.5">
          {row.summary}
          {rest > 0 ? (
            <>
              {/[.!?…]$/.test(row.summary.trim()) ? " 이 밖에 " : ". 이 밖에 "}
              <FactTrigger
                rows={[
                  { label: "AI 요약", value: `${row.summarized}건` },
                  ...(row.count > row.summarized
                    ? [{ label: "요약 없음", value: `${row.count - row.summarized}건` }]
                    : []),
                  {
                    label: "변경",
                    value: `+${row.additions.toLocaleString("ko-KR")} −${row.deletions.toLocaleString("ko-KR")}`,
                  },
                  { label: "파일", value: `${row.files.toLocaleString("ko-KR")}개` },
                ]}
                title="이 묶음의 커밋"
              >
                {`${rest}건`}
              </FactTrigger>
              을 더 커밋했어요.
            </>
          ) : null}
        </AiLine>
      ) : (
        <p className="m-0 mt-0.5 truncate text-[13px] leading-5 text-ink-2">{row.plain}</p>
      )}
      {open ? (
        <div className="ds-reveal mt-2 flex flex-col">
          {row.commits.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-[40px_minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 border-t border-line py-2 text-[13px] leading-5"
            >
              <span className="num text-xs text-ink-3">{c.time}</span>
              <span className="text-ink">
                {c.url ? (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-inherit no-underline hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    {c.main}
                  </a>
                ) : (
                  c.main
                )}
              </span>
              <span className="num text-xs whitespace-nowrap text-ink-3">{c.diff}</span>
              <span className="col-span-2 col-start-2 text-xs leading-[17px] break-words text-ink-3">
                {c.meta}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

function TxBody({
  row,
  onSelect,
  ...flag
}: { row: TxRow; onSelect: (id: string) => void } & FlagProps) {
  return (
    <>
      <button type="button" className={headClass} onClick={() => onSelect(row.id)}>
        <Name depth={1}>{row.merchant}</Name>
        <span className="num text-sm font-medium text-ink">{row.amount}</span>
        <span className="text-xs text-ink-3">{row.category}</span>
      </button>
      {flag.flag ? (
        <div className="mt-1">
          <Flag {...flag} />
        </div>
      ) : null}
      <FlagReason {...flag} />
    </>
  );
}

function IncomeBody({ row, onSelect }: { row: IncomeRow; onSelect: (id: string) => void }) {
  return (
    <button type="button" className={headClass} onClick={() => onSelect(row.id)}>
      <Name depth={1}>{row.label}</Name>
      <span className="num text-sm font-medium text-ink">{row.amount}</span>
      <span className="num text-xs text-ink-3">{row.note}</span>
    </button>
  );
}

const STAGE_LANE = { awake: 0, rem: 1, light: 2, deep: 3 } as const;
const STAGE_FILL = {
  awake: { fill: "var(--ink3)", opacity: 0.55 },
  rem: { fill: "var(--health)", opacity: 0.6 },
  light: { fill: "var(--health)", opacity: 0.35 },
  deep: { fill: "var(--health)", opacity: 1 },
} as const;

function SleepBody({
  row,
  open,
  onToggle,
  compact,
  ...flag
}: {
  row: SleepRow;
  open: boolean;
  onToggle: () => void;
  compact: boolean;
} & FlagProps) {
  const W = compact ? 150 : 200;
  const H = 22;
  const paths = { awake: "", rem: "", light: "", deep: "" };
  if (row.segments && row.inBedMin > 0) {
    for (const g of row.segments) {
      const x = (g.startMin / row.inBedMin) * W;
      const w = Math.max(0.8, ((g.endMin - g.startMin) / row.inBedMin) * W);
      const y = STAGE_LANE[g.stage] * 5.5;
      paths[g.stage] += `M${x.toFixed(1)} ${y.toFixed(1)}h${w.toFixed(1)}v4.5h-${w.toFixed(1)}z`;
    }
  }
  return (
    <>
      <button
        type="button"
        className={cn(headClass, "group pr-6")}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Name depth={1}>수면 {row.asleep}</Name>
        <span className="num text-xs text-ink-2">
          {row.range}
          {row.efficiency ? ` · 효율 ${row.efficiency}` : ""}
        </span>
        <Chevron />
      </button>
      {row.segments || flag.flag ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
          {row.segments ? (
            <svg
              role="img"
              aria-label="수면 단계 그래프"
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              className="block"
            >
              {(Object.keys(paths) as (keyof typeof paths)[]).map((k) => (
                <path
                  key={k}
                  d={paths[k]}
                  fill={STAGE_FILL[k].fill}
                  opacity={STAGE_FILL[k].opacity}
                />
              ))}
            </svg>
          ) : null}
          <Flag {...flag} />
        </div>
      ) : null}
      <FlagReason {...flag} />
      {open ? (
        <div className="ds-reveal mt-2 grid grid-cols-4 gap-2 pt-1">
          {row.stages?.map((g) => (
            <div key={g.label} className="flex flex-col gap-0.5">
              <span className="text-[11px] leading-[14px] text-ink-3">{g.label}</span>
              <span className="num text-[13px]">{g.value}</span>
            </div>
          ))}
          <span className="col-span-full text-[11px] leading-[14px] text-ink-3">
            누워 있던 시간 {row.inBed}
          </span>
        </div>
      ) : null}
    </>
  );
}
