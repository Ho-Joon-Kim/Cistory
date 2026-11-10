"use client";

import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import { AiLine, SecondaryNumber, useEvidence } from "@/components/ds";
import { formatMonthDay, formatWonCompact, signToneClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCategoryPaymentCounts } from "@/modules/overview/hooks";
import type { PeriodContext } from "@/modules/overview/view/labels";
import {
  type AssetModel,
  categoryPaymentFlags,
  type DetailTab,
  type DetailTabId,
  formatHours,
  type MoveModel,
} from "@/modules/overview/view/sections";
import { RankRow } from "./RankRow";
import { useMeasuredWidth } from "./useMeasuredWidth";
import { useTaggedEvidence } from "./useTaggedEvidence";

/** `-2.7%` — the period return at the precision the section reads at. */
function returnOneDecimal(ratio: number): string {
  const pct = Math.round(ratio * 1000) / 10;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(1)}%`;
}

export function SectionTitle({ children, id }: { children: string; id?: string }) {
  return (
    <h2
      id={id}
      className="m-0 font-serif text-[22px] leading-[30px] font-semibold tracking-[-0.02em] text-ink"
    >
      {children}
    </h2>
  );
}

// ── 이동과 장소 ───────────────────────────────────────────────────────────────

export function MoveSection({ move }: { move: MoveModel }) {
  const { stateOf } = useEvidence();
  return (
    <section aria-labelledby="ov-move">
      <SectionTitle id="ov-move">이동과 장소</SectionTitle>
      <dl className="m-0 mt-5 grid grid-cols-2 gap-x-10 gap-y-3 sm:flex sm:flex-wrap">
        {move.stats.map((s) => (
          <div key={s.label}>
            <dt className="text-label">{s.label}</dt>
            <dd className="m-0">
              <SecondaryNumber value={s.value} unit={s.unit} />
            </dd>
          </div>
        ))}
      </dl>
      <AiLine fact={move.fact} className="mt-2" />
      {move.places.length > 0 ? (
        <div className="mt-3 border-t border-line">
          {move.places.map((p) => (
            <RankRow
              key={p.key}
              name={p.name}
              shortName={p.shortName}
              flag={p.flag}
              flagTone="place"
              value={formatHours(p.seconds)}
              trailing={`${p.visits}회`}
              share={p.share}
              evidence={stateOf(p.key)}
              members={p.members?.map((m) => ({
                name: m.name,
                value: formatHours(m.seconds),
                flag: m.flag,
              }))}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ── 자산 ─────────────────────────────────────────────────────────────────────

export function AssetSection({ asset, ctx }: { asset: AssetModel; ctx: PeriodContext }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const { stateOf } = useTaggedEvidence("evaluation");
  const W = Math.min(width, 520);
  const H = 110;
  const pts = asset.points;
  const values = pts.map((p) => p.value);
  const lo = Math.min(...values) * 0.995;
  const hi = Math.max(...values) * 1.005;
  const x = (i: number) => (i / (pts.length - 1)) * (W - 8) + 4;
  const y = (v: number) => ((hi - v) / (hi - lo)) * (H - 12) + 6;
  const line = pts
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(" ");
  const tone = asset.twr !== null && asset.twr < 0 ? "var(--down)" : "var(--up)";
  const markIndex = asset.mark ? pts.findIndex((p) => p.date === asset.mark) : -1;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const gradientId = useId().replace(/:/g, "");
  return (
    <section aria-labelledby="ov-asset">
      <SectionTitle id="ov-asset">자산</SectionTitle>
      <div className="mt-5 flex items-baseline gap-2.5">
        {asset.twr !== null ? (
          <span
            className={cn(
              "num text-[22px] leading-7 font-medium",
              signToneClass(asset.twr, "market")
            )}
          >
            {returnOneDecimal(asset.twr)}
          </span>
        ) : null}
        <span className="text-label">기간 수익률 · {asset.days}일 기준</span>
      </div>
      <AiLine fact={asset.fact} className="mt-2" />
      <div ref={ref} className="mt-5">
        {W > 0 ? (
          <svg
            width={W}
            height={H}
            role="img"
            aria-label={`평가액 추이: ${formatMonthDay(first.date, { now: ctx.now })} ${formatWonCompact(first.value)}에서 ${formatMonthDay(last.date, { now: ctx.now })} ${formatWonCompact(last.value)}`}
            className="block overflow-visible"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={tone} stopOpacity=".14" />
                <stop offset="1" stopColor={tone} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={`${line} L${x(pts.length - 1).toFixed(1)} ${H} L4 ${H} Z`}
              fill={`url(#${gradientId})`}
            />
            <path d={line} fill="none" stroke={tone} strokeWidth="1.75" strokeLinejoin="round" />
            {markIndex >= 0 ? (
              <>
                <circle
                  cx={x(markIndex)}
                  cy={y(pts[markIndex].value)}
                  r="4"
                  fill="var(--bg)"
                  stroke="var(--ink)"
                  strokeWidth="1.5"
                />
                {stateOf(pts[markIndex].date) === "on" ? (
                  <circle
                    cx={x(markIndex)}
                    cy={y(pts[markIndex].value)}
                    r="8"
                    fill="none"
                    stroke="var(--brand)"
                    strokeWidth="2"
                  />
                ) : null}
              </>
            ) : null}
            <circle cx={x(pts.length - 1)} cy={y(last.value)} r="3.5" fill={tone} />
          </svg>
        ) : (
          <div style={{ height: H }} />
        )}
        <div className="mt-2.5 flex justify-between" style={{ maxWidth: W || undefined }}>
          <div>
            <span className="text-label">{formatMonthDay(first.date, { now: ctx.now })}</span>
            <div className="num text-[13px]">{formatWonCompact(first.value)}</div>
          </div>
          <div className="text-right">
            <span className="text-label">{formatMonthDay(last.date, { now: ctx.now })}</span>
            <div className="num text-[13px]">{formatWonCompact(last.value)}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── 자세히 ───────────────────────────────────────────────────────────────────

function HourPanel({ tab }: { tab: DetailTab }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="mt-4">
      <ul aria-label="시간대별 커밋" className="m-0 flex h-[120px] list-none items-end gap-1 p-0">
        {tab.hours?.map((h) => (
          <li
            key={h.hour}
            className="relative flex h-full flex-1 items-end"
            onMouseEnter={() => setHover(h.hour)}
            onMouseLeave={() => setHover(null)}
          >
            {hover === h.hour ? (
              <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 -translate-x-1/2 rounded-[7px] bg-surface px-2 py-1 text-xs whitespace-nowrap text-ink tabular-nums shadow-pop">
                {h.hour}시 · {h.value.toLocaleString("ko-KR")}
              </span>
            ) : null}
            <span className="sr-only">
              {h.hour}시 {h.value}건
            </span>
            <i
              aria-hidden="true"
              className={cn(
                "ds-grow block w-full rounded-t-[3px] rounded-b-[1px]",
                hover === h.hour ? "bg-ink" : h.night ? "bg-[var(--bar2)]" : "bg-bar"
              )}
              style={{ height: `${Math.max(2, h.ratio * 100)}%` }}
            />
          </li>
        ))}
      </ul>
      <div aria-hidden="true" className="mt-1.5 flex gap-1">
        {tab.hours?.map((h) => (
          <span key={h.hour} className="num flex-1 text-center text-[11px] text-ink-3">
            {h.hour % 3 === 0 ? h.hour : ""}
          </span>
        ))}
      </div>
      {tab.weekdays?.length ? (
        <div className="mt-5 border-t border-line">
          {tab.weekdays.map((w) => (
            <RankRow
              key={w.label}
              name={`${w.label}요일`}
              value={w.value.toLocaleString("ko-KR")}
              share={w.ratio}
              columns="minmax(0,1fr) auto 0px"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DetailsSection({
  tabs,
  paymentRange = null,
}: {
  tabs: DetailTab[];
  /** Period to count payments in, for `결제 N건` category flags (week/month). */
  paymentRange?: { from: string; to: string } | null;
}) {
  const [picked, setPicked] = useState<DetailTabId>(
    tabs.find((t) => t.id === "category")?.id ?? tabs[0]?.id ?? "repo"
  );
  const tab = tabs.find((t) => t.id === picked) ?? tabs[0];
  const categoryRows = tabs.find((t) => t.id === "category")?.rows;
  const counts = useCategoryPaymentCounts(categoryRows ? paymentRange : null);
  const paymentFlags = useMemo(
    () => categoryPaymentFlags(categoryRows ?? [], counts),
    [categoryRows, counts]
  );
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const { stateOf } = useEvidence();
  if (!tab) return null;
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : null;
    if (next === null) return;
    event.preventDefault();
    setPicked(tabs[next].id);
    refs.current[next]?.focus();
  };
  return (
    <section
      aria-labelledby="ov-details"
      className="grid grid-cols-1 gap-x-12 lg:grid-cols-[264px_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <SectionTitle id="ov-details">자세히</SectionTitle>
        <div
          role="tablist"
          aria-label="상세 항목"
          className="mt-4 flex flex-wrap gap-0.5 lg:flex-col lg:flex-nowrap"
        >
          {tabs.map((t, i) => {
            const on = t.id === tab.id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${t.id}`}
                aria-selected={on}
                aria-controls={`${baseId}-panel`}
                tabIndex={on ? 0 : -1}
                onClick={() => setPicked(t.id)}
                onKeyDown={(e) => onKey(e, i)}
                className={cn(
                  "flex h-11 shrink-0 cursor-pointer items-center justify-between gap-3 rounded-[10px] border-0 px-3.5 text-left text-sm whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-brand lg:w-full",
                  on
                    ? "bg-brand-soft font-semibold text-ink"
                    : "bg-transparent font-medium text-ink-2 hover:bg-track hover:text-ink"
                )}
              >
                <span>{t.label}</span>
                {t.hint ? (
                  <span className="num hidden text-xs font-normal text-ink-3 lg:inline">
                    {t.hint}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${tab.id}`}
        className="mt-4 max-w-[760px] min-w-0 lg:mt-0 lg:min-h-[460px] lg:pt-[46px]"
      >
        <AiLine fact={tab.fact} />
        {tab.id === "hour" ? (
          <HourPanel tab={tab} />
        ) : (
          <div className="mt-3 border-t border-line">
            {tab.rows.map((r) => (
              <RankRow
                key={r.key}
                name={r.name}
                sub={r.sub}
                flag={r.flag ?? (tab.id === "category" ? paymentFlags[r.key] : null)}
                flagTone={r.flagTone}
                value={r.value}
                trailing={r.pct}
                share={r.share}
                current={r.current}
                evidence={stateOf(r.key)}
                members={r.members}
                columns="minmax(0,1fr) auto 56px"
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
