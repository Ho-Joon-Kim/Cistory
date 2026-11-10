"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { type CSSProperties, useState } from "react";
import { isQuantityText } from "@/lib/facts/face";
import { formatDateTime, formatDay, MINUS } from "@/lib/format";
import type { BodyMetricSummary, BodyResult } from "@/modules/insights/service";
import { type DetailRow, fmtNum } from "../view-model";

function spark(values: (number | null)[], lo: number, hi: number): string {
  const n = Math.max(1, values.length - 1);
  return values
    .flatMap((v, i) =>
      v == null
        ? []
        : [`${((i / n) * 100).toFixed(2)},${((1 - (v - lo) / (hi - lo || 1)) * 100).toFixed(2)}`]
    )
    .join(" ");
}

function Spark({ row }: { row: DetailRow }) {
  const pad = (row.max - row.min) * 0.15 || 1;
  return (
    <span className="relative block h-7">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 size-full overflow-visible"
      >
        <polyline
          points={spark(row.values, row.min - pad, row.max + pad)}
          fill="none"
          stroke="var(--health)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

interface CompRow {
  label: string;
  unit: string;
  decimals: number;
  m: BodyMetricSummary;
}

function compRows(body: BodyResult): CompRow[] {
  return [
    { label: "체지방률", unit: "%", decimals: 1, m: body.fatRatioPct },
    { label: "근육량", unit: "kg", decimals: 1, m: body.muscleMassKg },
    { label: "체수분", unit: "kg", decimals: 1, m: body.hydrationKg },
    { label: "뼈 무게", unit: "kg", decimals: 2, m: body.boneMassKg },
    { label: "내장지방 지수", unit: "", decimals: 1, m: body.visceralFat },
    { label: "기초대사량", unit: "kcal", decimals: 0, m: body.bmrKcal },
    { label: "대사 나이", unit: "세", decimals: 0, m: body.metabolicAge },
    { label: "체중계 심박", unit: "bpm", decimals: 0, m: body.heartRateBpm },
  ].filter((r) => r.m.latest != null);
}

/** Change since the previous measurement: a signed quantity, "변화 없음", or null. */
function compDelta(r: CompRow): string | null {
  const d = r.m.delta;
  if (d == null) return null;
  const shown = fmtNum(Math.abs(d), r.decimals);
  return Number(shown.replace(/,/g, "")) === 0
    ? "변화 없음"
    : `${d > 0 ? "+" : MINUS}${shown}${r.unit === "%" ? "%p" : r.unit}`;
}

/** Min–max over the window, when it is a range at all. */
function compRange(r: CompRow): string | null {
  if (r.m.min == null || r.m.max == null || r.m.min === r.m.max) return null;
  return `${fmtNum(r.m.min, r.decimals)}–${fmtNum(r.m.max, r.decimals)}`;
}

/** Delta in mono (when it is a quantity), the "범위" word in the surrounding face. */
function CompMeta({ row }: { row: CompRow }) {
  const delta = compDelta(row);
  const range = compRange(row);
  return (
    <>
      {delta ? <span className={isQuantityText(delta) ? "num" : undefined}>{delta}</span> : null}
      {delta && range ? " · " : null}
      {range ? (
        <>
          범위 <span className="num">{range}</span>
        </>
      ) : null}
    </>
  );
}

/** One-line summary shown on the disclosure. */
export function detailsSummary(rows: DetailRow[], body: BodyResult | null): string {
  const pick = ["hrv", "spo2", "skin_temperature"];
  const parts = rows
    .filter((r) => pick.includes(r.key))
    .map((r) => `${r.label} ${fmtNum(r.latest, r.decimals)}${r.unit}`);
  const n = body ? compRows(body).length : 0;
  if (n > 0) parts.push(`체성분 ${n}항목`);
  return parts.join(" · ");
}

const CLOSE_ICON = (
  <svg
    aria-hidden="true"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export function DetailsSheet({
  rows,
  body,
  style,
  className,
}: {
  rows: DetailRow[];
  body: BodyResult | null;
  style?: CSSProperties;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const comps = body ? compRows(body) : [];
  const summary = detailsSummary(rows, body);
  const latestDay = rows.reduce<string | null>(
    (a, r) => (a == null || r.latestDay > a ? r.latestDay : a),
    null
  );
  if (rows.length === 0 && comps.length === 0) return null;

  return (
    <section className={className} style={style}>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
          <button
            type="button"
            className="group -mx-3 flex w-[calc(100%+24px)] cursor-pointer items-center gap-4 rounded-xl border-0 bg-transparent px-3 py-3.5 text-left transition-colors duration-150 hover:bg-track focus-visible:outline-2 focus-visible:outline-brand lg:-mx-4 lg:w-[calc(100%+32px)] lg:px-4 lg:py-[18px]"
          >
            <span className="flex min-w-0 flex-col gap-0.5 lg:flex-row lg:items-center lg:gap-4">
              <span className="font-serif text-[17px] leading-6 font-semibold tracking-[-0.02em] text-ink lg:text-lg lg:leading-[26px]">
                세부 지표
              </span>
              <span className="text-xs leading-[18px] text-ink-2 tabular-nums lg:text-[13px]">
                {summary}
              </span>
            </span>
            <span className="ml-auto inline-flex text-ink-2 transition-[rotate] duration-150 group-aria-expanded:rotate-180">
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[min(720px,calc(100dvh-48px))] flex-col overflow-y-auto overscroll-contain rounded-t-[20px] bg-surface px-4 pt-2 pb-8 shadow-ring outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 lg:inset-x-6 xl:inset-x-24 lg:bottom-8 lg:max-h-[min(640px,calc(100dvh-64px))] lg:rounded-[18px] lg:px-7 lg:py-6 lg:shadow-pop"
          >
            <span
              aria-hidden="true"
              className="mx-auto mt-1 mb-2 h-1 w-9 shrink-0 rounded-full bg-bar lg:hidden"
            />
            <div className="flex items-center justify-between">
              <DialogPrimitive.Title className="m-0 font-serif text-xl leading-7 font-semibold tracking-[-0.02em] text-ink lg:text-[22px] lg:leading-[30px]">
                세부 지표
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="닫기"
                className="inline-flex size-11 cursor-pointer items-center justify-center rounded-[9px] border-0 bg-transparent text-ink-2 hover:bg-track active:scale-[.96] lg:size-9"
              >
                {CLOSE_ICON}
              </DialogPrimitive.Close>
            </div>
            <div className="mt-3 flex flex-col gap-5 lg:mt-4 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-x-12">
              {rows.length > 0 ? (
                <div>
                  <p className="text-label m-0 border-b border-line pb-2">
                    심혈관 · 호흡 — Fitbit
                    {latestDay ? `, ${formatDay(latestDay)} 값과 30일 범위` : ""}
                  </p>
                  {rows.map((r) => (
                    <div
                      key={r.key}
                      className="grid grid-cols-[minmax(0,1fr)_80px_96px] items-center gap-3 border-b border-line py-3 text-sm leading-[22px] lg:grid-cols-[120px_120px_minmax(0,1fr)_150px]"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="text-ink">{r.label}</span>
                        {r.note ? (
                          <span className="hidden text-xs leading-4 text-ink-3 lg:block">
                            {r.note}
                          </span>
                        ) : null}
                        <span className="text-[11px] leading-[14px] text-ink-3 lg:hidden">
                          중앙값 <span className="num">{fmtNum(r.median, r.decimals)}</span> ·{" "}
                          <span className="num">
                            {fmtNum(r.min, r.decimals)}–{fmtNum(r.max, r.decimals)}
                          </span>
                        </span>
                      </span>
                      <span className="order-last text-right lg:order-none lg:text-left">
                        <span className="num text-base font-medium text-ink lg:text-lg">
                          {fmtNum(r.latest, r.decimals)}
                        </span>
                        <span className="text-[11px] font-medium text-ink-3 lg:text-xs">
                          {" "}
                          {r.unit}
                        </span>
                      </span>
                      <Spark row={r} />
                      <span className="hidden text-right text-xs text-ink-3 lg:block">
                        중앙값 <span className="num">{fmtNum(r.median, r.decimals)}</span> ·{" "}
                        <span className="num">
                          {fmtNum(r.min, r.decimals)}–{fmtNum(r.max, r.decimals)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {comps.length > 0 && body ? (
                <div>
                  <p className="text-label m-0 border-b border-line pb-2">
                    체성분 — Withings
                    {body.latestMeasuredAt
                      ? `, ${formatDateTime(new Date(body.latestMeasuredAt))}`
                      : ""}{" "}
                    · 직전 측정 대비
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 lg:gap-x-6">
                    {comps.map((c) => (
                      <div key={c.label} className="flex flex-col gap-1 border-b border-line py-3">
                        <span className="text-label">{c.label}</span>
                        <span>
                          <span className="num text-[17px] font-medium text-ink lg:text-lg">
                            {fmtNum(c.m.latest as number, c.decimals)}
                          </span>
                          {c.unit ? (
                            <span className="text-xs font-medium text-ink-3"> {c.unit}</span>
                          ) : null}
                        </span>
                        <span className="text-[11px] text-ink-3 tabular-nums lg:text-xs">
                          <CompMeta row={c} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </section>
  );
}
