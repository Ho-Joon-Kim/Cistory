/**
 * Pure derivations behind the /spending page: monthly bars split into
 * 의료·건강 vs the rest, the comparison baselines, the KST-day ledger with
 * refunds netted, and the template-first facts for its AI lines. No React, no
 * fetching — the page feeds API payloads in and renders what comes out.
 */
import { shiftDateKey, toKstCalendarDate } from "@/lib/date-key";
import { iGa } from "@/lib/facts/template";
import type { Fact, FactRow } from "@/lib/facts/types";
import {
  formatDateRange,
  formatShare,
  formatTime,
  formatWon,
  formatWonCompact,
} from "@/lib/format";
import type { CategoryTotals, SpendingCategoryKey } from "./categories";
import { SPENDING_CATEGORY_LABELS } from "./categories";
import type { TransactionItem } from "./hooks";
import { merchantBase } from "./refund";
import type { MonthlyBarDataPoint, SpendingTrendResponse } from "./types";

/** The category the page splits out: large, rare, and not a run-rate. */
export const SPLIT_CATEGORY: SpendingCategoryKey = "health";
export const SPLIT_LABEL = SPENDING_CATEGORY_LABELS[SPLIT_CATEGORY];

// ── months ───────────────────────────────────────────────────────────────────

export interface MonthBar {
  /** "YYYY-MM" */
  key: string;
  year: number;
  month: number;
  /** "11월" */
  label: string;
  total: number;
  health: number;
  rest: number;
  categories: CategoryTotals;
  isCurrent: boolean;
}

function barKey(bar: MonthlyBarDataPoint, fallbackYear: string): string {
  return bar.key ?? `${fallbackYear}-${bar.month}`;
}

/** The trend's monthly bars, oldest first, at most `limit` months ending with the current one. */
export function toMonthBars(
  trend: Pick<SpendingTrendResponse, "monthlyBars">,
  now = new Date(),
  limit = 12
): MonthBar[] {
  const year = toKstCalendarDate(now).slice(0, 4);
  return trend.monthlyBars
    .map((bar) => {
      const key = barKey(bar, year);
      const health = bar.categories?.[SPLIT_CATEGORY] ?? 0;
      return {
        key,
        year: Number(key.slice(0, 4)),
        month: Number(key.slice(5, 7)),
        label: `${Number(key.slice(5, 7))}월`,
        total: bar.total,
        health,
        rest: Math.max(0, bar.total - health),
        categories: bar.categories ?? {},
        isCurrent: bar.isCurrent,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-limit);
}

/** "3–10월" within one year, else "최근 N개월"; a single month is just "10월". */
export function monthSpanLabel(bars: MonthBar[]): string {
  if (bars.length === 0) return "";
  const first = bars[0];
  const last = bars[bars.length - 1];
  if (bars.length === 1) return last.label;
  if (first.year !== last.year) return `최근 ${bars.length}개월`;
  return `${first.month}–${last.month}월`;
}

export interface Baseline {
  /** "3–10월" / "10월" */
  label: string;
  total: number;
  health: number;
  rest: number;
}

/** Monthly average over every completed month in the window. */
export function averageBaseline(bars: MonthBar[]): Baseline | null {
  const past = bars.filter((b) => !b.isCurrent);
  if (past.length === 0) return null;
  const avg = (pick: (b: MonthBar) => number) =>
    Math.round(past.reduce((sum, b) => sum + pick(b), 0) / past.length);
  return {
    label: monthSpanLabel(past),
    total: avg((b) => b.total),
    health: avg((b) => b.health),
    rest: avg((b) => b.rest),
  };
}

/** The calendar month right before `current`, when it has data. */
export function previousMonth(bars: MonthBar[], current: MonthBar | undefined): MonthBar | null {
  if (!current) return null;
  const prevKey = shiftDateKey(`${current.key}-01`, -1).slice(0, 7);
  return bars.find((b) => b.key === prevKey) ?? null;
}

/** Three evenly spaced "nice" ticks whose top covers `max` (2,4,6백만 for 5.7M). */
export function niceTicks(max: number): { ticks: number[]; top: number } {
  if (!(max > 0)) return { ticks: [1, 2, 3], top: 3 };
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  const step = nice * pow;
  return { ticks: [step, step * 2, step * 3], top: step * 3 };
}

/** "600만" — axis tick text. */
export function tickLabel(value: number): string {
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만`;
  return value.toLocaleString("ko-KR");
}

const COUNT_WORDS = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
/** "다섯 달" / "12달". */
export function monthsWord(n: number): string {
  return n <= 10 ? `${COUNT_WORDS[n]} 달` : `${n}달`;
}

// ── chart annotations ────────────────────────────────────────────────────────

export interface MonthAnnotation {
  key: string;
  category: SpendingCategoryKey;
  value: number;
  /** "의료·건강 458.0만원" */
  text: string;
}

/**
 * Up to two months whose single largest category explains an above-average
 * total (it holds ≥ 40% of the month). Most valuable first.
 */
export function monthAnnotations(bars: MonthBar[], average: number | null): MonthAnnotation[] {
  if (average === null) return [];
  const candidates: MonthAnnotation[] = [];
  for (const bar of bars) {
    if (bar.total <= average) continue;
    const top = Object.entries(bar.categories)
      .map(([category, value]) => ({
        category: category as SpendingCategoryKey,
        value: value ?? 0,
      }))
      .sort((a, b) => b.value - a.value)[0];
    if (!top || top.value < bar.total * 0.4) continue;
    candidates.push({
      key: bar.key,
      category: top.category,
      value: top.value,
      text: `${SPENDING_CATEGORY_LABELS[top.category]} ${formatWonCompact(top.value)}`,
    });
  }
  // One annotation per category, the biggest of each.
  const best = new Map<string, MonthAnnotation>();
  for (const c of candidates.sort((a, b) => b.value - a.value)) {
    if (!best.has(c.category)) best.set(c.category, c);
  }
  return [...best.values()].slice(0, 2);
}

// ── categories ───────────────────────────────────────────────────────────────

export interface CategoryShare {
  category: SpendingCategoryKey;
  value: number;
  /** Share of `base` (0..1). */
  share: number;
  /** Bar width relative to the largest row (0..1). */
  width: number;
  count?: number;
}

export function categoryShares(
  categories: CategoryTotals,
  options: { excludeSplit: boolean; counts?: Partial<Record<SpendingCategoryKey, number>> }
): { rows: CategoryShare[]; base: number } {
  const entries = Object.entries(categories)
    .map(([category, value]) => ({ category: category as SpendingCategoryKey, value: value ?? 0 }))
    .filter((e) => e.value > 0 && !(options.excludeSplit && e.category === SPLIT_CATEGORY))
    .sort((a, b) => b.value - a.value || a.category.localeCompare(b.category));
  const base = entries.reduce((sum, e) => sum + e.value, 0);
  const top = entries[0]?.value ?? 1;
  return {
    base,
    rows: entries.map((e) => ({
      ...e,
      share: base > 0 ? e.value / base : 0,
      width: e.value / top,
      count: options.counts?.[e.category],
    })),
  };
}

// ── ledger ───────────────────────────────────────────────────────────────────

/** Spending is written negative, money in positive; cash stays ink either way. */
export function signedAmount(tx: Pick<TransactionItem, "type" | "amount">): number {
  return tx.type === "withdrawal" ? -tx.amount : tx.amount;
}

export function txDayKey(tx: Pick<TransactionItem, "transactedAt">): string {
  return toKstCalendarDate(new Date(tx.transactedAt));
}

export type LedgerRow =
  | { kind: "tx"; id: string; tx: TransactionItem }
  | {
      kind: "refunds";
      id: string;
      /** Payer name without Toss's suffix ("한국철도공사"). */
      merchant: string;
      items: TransactionItem[];
      total: number;
    };

export interface LedgerDay {
  key: string;
  spend: number;
  refund: number;
  rows: LedgerRow[];
  /** Transactions on the day (a refund group counts each refund). */
  count: number;
}

/**
 * Groups transactions (newest first) by KST day. Refunds from one payer on one
 * day collapse into a single row at the newest one's position; the day header
 * carries the day's spending and refunds.
 */
export function groupLedger(rows: TransactionItem[]): LedgerDay[] {
  const days = new Map<string, TransactionItem[]>();
  for (const tx of rows) {
    const key = txDayKey(tx);
    const list = days.get(key);
    if (list) list.push(tx);
    else days.set(key, [tx]);
  }
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => {
      const sorted = items
        .slice()
        .sort((a, b) => new Date(b.transactedAt).getTime() - new Date(a.transactedAt).getTime());
      const refundsByPayer = new Map<string, TransactionItem[]>();
      for (const tx of sorted) {
        if (!tx.isRefund) continue;
        const base = merchantBase(tx.merchant);
        refundsByPayer.set(base, [...(refundsByPayer.get(base) ?? []), tx]);
      }
      const ledgerRows: LedgerRow[] = [];
      const placed = new Set<string>();
      for (const tx of sorted) {
        const base = tx.isRefund ? merchantBase(tx.merchant) : "";
        const group = tx.isRefund ? (refundsByPayer.get(base) ?? []) : [];
        if (group.length > 1) {
          if (placed.has(base)) continue;
          placed.add(base);
          ledgerRows.push({
            kind: "refunds",
            id: `refunds:${key}:${base}`,
            merchant: base,
            items: group,
            total: group.reduce((sum, r) => sum + r.amount, 0),
          });
          continue;
        }
        ledgerRows.push({ kind: "tx", id: tx.id, tx });
      }
      return {
        key,
        spend: sorted.filter((t) => t.bucket === "spending").reduce((s, t) => s + t.amount, 0),
        refund: sorted.filter((t) => t.isRefund).reduce((s, t) => s + t.amount, 0),
        rows: ledgerRows,
        count: sorted.length,
      };
    });
}

export type RowTag = "집계 제외" | "환불" | "입금" | "결제 취소" | null;

export function rowTag(tx: TransactionItem): RowTag {
  if (tx.type === "cancel") return "결제 취소";
  if (tx.isRefund) return "환불";
  if (tx.bucket === "ignore") return "집계 제외";
  if (tx.bucket === "income") return "입금";
  return null;
}

export type LedgerMarkFor =
  | { kind: "category"; category: SpendingCategoryKey }
  | { kind: "ledger"; mark: "deposit" | "refund" | "self_transfer" };

export function rowMark(tx: TransactionItem): LedgerMarkFor {
  if (tx.isRefund || tx.type === "cancel") return { kind: "ledger", mark: "refund" };
  if (tx.bucket === "spending")
    return { kind: "category", category: tx.category ?? "uncategorized" };
  if (tx.bucket === "income") return { kind: "ledger", mark: "deposit" };
  if (tx.type === "withdrawal" && tx.category) return { kind: "category", category: tx.category };
  return { kind: "ledger", mark: "self_transfer" };
}

/** "21:28" */
export function txTime(tx: Pick<TransactionItem, "transactedAt">): string {
  return formatTime(new Date(tx.transactedAt));
}

// ── flags ────────────────────────────────────────────────────────────────────

export interface RowFlagInfo {
  label: string;
  reason: string;
}

export interface FlagContext {
  /** forecast.oneOffThreshold — a single charge above it is a one-off. */
  oneOffThreshold: number | null;
  /** Month-to-date spending total and its one-off-free remainder. */
  monthTotal: number;
  monthRest: number;
  monthRestCount: number;
  /** Id of the month's largest everyday (non one-off) charge, if notable. */
  monthMaxId: string | null;
  monthLabel: string;
  /** Refund totals for the reason line of refund rows. */
  refundTotal: number;
  refundCount: number;
  spendTotal: number;
}

export function isOneOff(tx: TransactionItem, threshold: number | null): boolean {
  return tx.bucket === "spending" && threshold !== null && tx.amount > threshold;
}

/**
 * The month's largest charge that isn't a one-off, when it is at least 20% of
 * the everyday total (otherwise "the biggest" is just noise).
 */
export function monthMaxCharge(
  monthRows: TransactionItem[],
  threshold: number | null
): { id: string; amount: number } | null {
  const everyday = monthRows.filter(
    (t) => t.bucket === "spending" && !isOneOff(t, threshold) && t.category !== SPLIT_CATEGORY
  );
  const rest = everyday.reduce((s, t) => s + t.amount, 0);
  const max = everyday.slice().sort((a, b) => b.amount - a.amount)[0];
  if (!max || rest <= 0 || max.amount / rest < 0.2 || everyday.length < 3) return null;
  return { id: max.id, amount: max.amount };
}

export function rowFlag(tx: TransactionItem, ctx: FlagContext): RowFlagInfo | null {
  if (tx.isRefund) return refundFlag(ctx, { count: 1, total: tx.amount });
  if (isOneOff(tx, ctx.oneOffThreshold) && ctx.monthTotal > 0) {
    const share = tx.amount / ctx.monthTotal;
    const times = ctx.monthRest > 0 ? (tx.amount / ctx.monthRest).toFixed(1) : null;
    return {
      label: "1회성",
      reason: `${ctx.monthLabel} 지출의 ${formatShare(Math.min(1, share))}${
        times && ctx.monthRestCount > 0
          ? `, 나머지 ${ctx.monthRestCount}건 합계의 ${times}배예요.`
          : "예요."
      } 월말 예상에서는 한 번만 더했어요.`,
    };
  }
  if (tx.id === ctx.monthMaxId && ctx.monthRest > 0) {
    return {
      label: `${ctx.monthLabel} 최대`,
      reason: `${SPLIT_LABEL}을 빼면 ${ctx.monthLabel}에 가장 큰 결제예요. 나머지 지출의 ${formatShare(
        tx.amount / ctx.monthRest
      )}예요.`,
    };
  }
  return null;
}

/**
 * Why a refund row is subtracted. With `scope` (a ledger row's own refunds) the
 * sentence is about that row and names the period total separately, so a day
 * row never reads like it holds the whole period's refunds.
 */
export function refundFlag(
  ctx: FlagContext,
  scope?: { count: number; total: number }
): RowFlagInfo {
  if (scope) {
    const net = formatWon(Math.max(0, ctx.spendTotal - ctx.refundTotal));
    const period =
      ctx.refundCount > scope.count
        ? ` 이 기간 환불은 모두 ${ctx.refundCount}건 ${formatWon(ctx.refundTotal)}, 순지출은 ${net}이에요.`
        : ` 이 기간 순지출은 ${net}이에요.`;
    return {
      label: "순지출에서 차감",
      reason: `이 환불 ${scope.count}건 ${formatWon(scope.total)}은 지출에서 빼 순지출로 계산해요.${period}`,
    };
  }
  return {
    label: "순지출에서 차감",
    reason: `환불 ${ctx.refundCount}건 ${formatWon(ctx.refundTotal)}은 지출 ${formatWon(
      ctx.spendTotal
    )}에서 빼 순지출 ${formatWon(Math.max(0, ctx.spendTotal - ctx.refundTotal))}으로 계산했어요.`,
  };
}

// ── hero ─────────────────────────────────────────────────────────────────────

export interface HeroModel {
  monthLabel: string;
  day: number;
  daysInMonth: number;
  total: number;
  health: number;
  healthCount: number;
  /** The single 의료·건강 charge, when there is exactly one. */
  healthItem: { merchant: string; dayKey: string } | null;
  rest: number;
  restCount: number;
  perDay: number;
  previous: MonthBar | null;
  average: Baseline | null;
}

export function heroSentence(hero: HeroModel, mode: "all" | "ex"): string {
  const { day, average, previous } = hero;
  if (mode === "ex") {
    const base = `${SPLIT_LABEL}을 빼면 ${day}일 동안 ${formatWon(hero.rest)}, 하루 ${formatWon(
      hero.perDay
    )}이에요.`;
    return average
      ? `${base} 같은 기준 ${average.label} 월평균은 ${formatWon(average.rest)}이에요.`
      : base;
  }
  const parts: string[] = [];
  if (average && average.total > 0) {
    parts.push(`${average.label} 월평균의 ${formatShare(hero.total / average.total)}`);
  }
  if (previous && previous.total > 0) {
    parts.push(`${previous.label} 전체의 ${formatShare(hero.total / previous.total)}`);
  }
  const lead =
    parts.length > 0
      ? `${day}일 만에 ${parts.join(", ")}를 썼어요.`
      : `${day}일 동안 ${formatWon(hero.total)}을 썼어요.`;
  if (hero.health <= 0) return lead;
  const n = hero.healthCount === 1 ? "한 건" : `${hero.healthCount}건`;
  return `${lead} 그중 ${formatWon(hero.health)}은 ${SPLIT_LABEL} ${n}이에요.`;
}

// ── facts (AI lines) ─────────────────────────────────────────────────────────

const pct = (ratio: number) => formatShare(ratio);

/**
 * Hero line: what the everyday pace adds up to over a month, against the same
 * baseline without 의료·건강. Notable when 의료·건강 distorts the month (≥ 20%
 * of it) or the pace is ≥ 20% off the usual month.
 */
export function heroPaceFact(hero: HeroModel, periodFrom: string, periodTo: string): Fact | null {
  const { average } = hero;
  if (!average || average.rest <= 0 || hero.day < 3) return null;
  const projected = Math.round(hero.perDay * hero.daysInMonth);
  const ratio = projected / average.rest;
  const distorted = hero.total > 0 && hero.health / hero.total >= 0.2;
  const score = Math.max(distorted ? 0.8 : 0, Math.min(1, Math.abs(ratio - 1) / 0.4));
  const rows: FactRow[] = [];
  if (hero.health > 0) {
    rows.push({
      label: "1회성",
      value: `${SPLIT_LABEL} ${hero.healthCount}건 ${formatWon(hero.health)}`,
    });
  }
  rows.push(
    {
      label: hero.health > 0 ? "나머지" : "지출",
      value: `${hero.restCount}건 ${formatWon(hero.rest)} · ${hero.day}일`,
    },
    { label: "한 달 환산", value: `하루 ${formatWon(hero.perDay)} × ${hero.daysInMonth}일` },
    {
      label: "비교 기준",
      value: `${average.label} ${SPLIT_LABEL} 제외 월평균 ${formatWon(average.rest)}`,
    }
  );
  return {
    id: "spending.hero.pace",
    kind: "delta",
    metric: "spending",
    metricLabel: "지출",
    period: { from: periodFrom, to: periodTo, label: hero.monthLabel },
    value: projected,
    unit: "won",
    baseline: { value: average.rest, label: average.label, kind: "usual" },
    score,
    evidence: { kind: "keys", keys: ["rest"] },
    template:
      hero.health > 0
        ? "나머지 속도라면 한 달 {fact} — {splitLabel}을 뺀 {baseline} 월평균 {baselineWon}의 {ratioPct} 수준이에요."
        : "이 속도라면 한 달 {fact} — {baseline} 월평균 {baselineWon}의 {ratioPct} 수준이에요.",
    detail: {
      trigger: formatWon(projected),
      splitLabel: SPLIT_LABEL,
      baselineWon: formatWon(average.rest),
      ratioPct: pct(ratio),
    },
    rows,
  };
}

/** Monthly chart line: how much of the window 의료·건강 explains. */
export function chartSplitFact(bars: MonthBar[], threshold: number | null): Fact | null {
  const limit = threshold ?? 500_000;
  const heavy = bars.filter((b) => b.health >= limit);
  const all = bars.reduce((s, b) => s + b.total, 0);
  const sum = heavy.reduce((s, b) => s + b.health, 0);
  const past = bars.filter((b) => !b.isCurrent);
  if (heavy.length < 2 || all <= 0 || past.length === 0) return null;
  const share = sum / all;
  const avgRest = Math.round(past.reduce((s, b) => s + b.rest, 0) / past.length);
  const rows: FactRow[] = heavy.map((b) => ({
    label: b.label,
    value: `${SPLIT_LABEL} ${formatWon(b.health)} / 전체 ${formatWon(b.total)}`,
  }));
  rows.push({
    label: "비교 기준",
    value: `${monthSpanLabel(past)} ${SPLIT_LABEL} 제외 월평균 ${formatWon(avgRest)}`,
  });
  return {
    id: "spending.months.split",
    kind: "concentration",
    metric: "spending",
    metricLabel: "지출",
    period: { from: bars[0].key, to: bars[bars.length - 1].key, label: monthSpanLabel(bars) },
    value: share,
    unit: "percent",
    score: Math.min(1, share / 0.3),
    evidence: { kind: "keys", keys: heavy.map((b) => `split:${b.key}`) },
    template:
      "{splitLabel}이 {monthList}월 {monthsWord}에 걸쳐 {fact} — 빼고 보면 {pastLabel}은 월평균 {avgRest}이에요.",
    detail: {
      trigger: formatWon(sum),
      splitLabel: SPLIT_LABEL,
      monthList: heavy.map((b) => b.month).join("·"),
      monthsWord: monthsWord(heavy.length),
      pastLabel: monthSpanLabel(past),
      avgRest: formatWonCompact(avgRest),
    },
    rows,
  };
}

/**
 * Category line for the current month: the top everyday category and the payee
 * that dominates it ("식비가 … 그중 쿠팡이츠 5건이 111,680원").
 */
export function topMerchantFact(
  monthRows: TransactionItem[],
  rest: number,
  monthLabel: string,
  day: number,
  period: { from: string; to: string }
): Fact | null {
  if (rest <= 0) return null;
  const everyday = monthRows.filter(
    (t) => t.bucket === "spending" && t.category !== SPLIT_CATEGORY
  );
  const byCategory = new Map<SpendingCategoryKey, TransactionItem[]>();
  for (const t of everyday) {
    const c = t.category ?? "uncategorized";
    byCategory.set(c, [...(byCategory.get(c) ?? []), t]);
  }
  const top = [...byCategory.entries()]
    .map(([category, items]) => ({
      category,
      items,
      total: items.reduce((s, t) => s + t.amount, 0),
    }))
    .sort((a, b) => b.total - a.total)[0];
  if (!top) return null;
  const share = top.total / rest;
  const byMerchant = new Map<string, TransactionItem[]>();
  for (const t of top.items) {
    const m = merchantBase(t.merchant);
    byMerchant.set(m, [...(byMerchant.get(m) ?? []), t]);
  }
  const merchant = [...byMerchant.entries()]
    .map(([name, items]) => ({ name, items, total: items.reduce((s, t) => s + t.amount, 0) }))
    .sort((a, b) => b.total - a.total)[0];
  if (!merchant || merchant.items.length < 2 || merchant.total / top.total < 0.4 || share < 0.3) {
    return null;
  }
  const days = merchant.items.map(txDayKey).sort();
  const label = SPENDING_CATEGORY_LABELS[top.category];
  return {
    id: "spending.categories.merchant",
    kind: "concentration",
    metric: "spending",
    metricLabel: label,
    period: { ...period, label: monthLabel },
    value: share,
    unit: "percent",
    score: Math.min(1, share / 0.4),
    evidence: { kind: "keys", keys: [top.category] },
    template:
      "{categoryLabel}{iGa} {splitLabel} 제외 지출의 {sharePct}, 그중 {merchant} {count}건이 {fact}이에요.",
    detail: {
      trigger: formatWon(merchant.total),
      categoryLabel: label,
      iGa: iGa(label),
      splitLabel: SPLIT_LABEL,
      sharePct: pct(share),
      merchant: merchant.name,
      count: String(merchant.items.length),
    },
    rows: [
      { label, value: `${formatWon(top.total)} · ${top.items.length}건` },
      {
        label: merchant.name,
        value: `${merchant.items.length}건 ${formatWon(merchant.total)} · ${formatDateRange(
          days[0],
          days[days.length - 1]
        )}`,
      },
      { label: "기준", value: `${monthLabel} 1–${day}일 ${SPLIT_LABEL} 제외 ${formatWon(rest)}` },
    ],
  };
}

// ── ledger period ────────────────────────────────────────────────────────────

export type LedgerPeriod = "month" | "prev" | "3m" | "1y";

export const LEDGER_PERIODS: ReadonlyArray<{ value: LedgerPeriod; label: string }> = [
  { value: "month", label: "이번 달" },
  { value: "prev", label: "지난달" },
  { value: "3m", label: "3개월" },
  { value: "1y", label: "1년" },
];

function monthStart(dayKey: string, monthsBack: number): string {
  let y = Number(dayKey.slice(0, 4));
  let m = Number(dayKey.slice(5, 7)) - monthsBack;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Inclusive KST date-key range of a ledger period ending today. */
export function periodRange(period: LedgerPeriod, today: string): { from: string; to: string } {
  switch (period) {
    case "prev": {
      const thisMonth = monthStart(today, 0);
      return { from: monthStart(today, 1), to: shiftDateKey(thisMonth, -1) };
    }
    case "3m":
      return { from: monthStart(today, 2), to: today };
    case "1y":
      return { from: monthStart(today, 11), to: today };
    default:
      return { from: monthStart(today, 0), to: today };
  }
}

// ── raw notifications ────────────────────────────────────────────────────────

/**
 * Display-only: Toss titles carry pictographs ("📈 …") that clash with the
 * type. Strips emoji (and their joiners/variation selectors) and tidies spaces;
 * the stored notification is untouched.
 */
export function displayNotificationTitle(title: string | null | undefined): string {
  if (!title) return "";
  return title
    .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}|\u{200D}|\u{20E3}/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
