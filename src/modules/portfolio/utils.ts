export function formatKRW(
  value: number,
  options: { compact?: boolean; sign?: boolean } = {}
): string {
  const sign = options.sign && value > 0 ? "+" : "";
  if (options.compact && Math.abs(value) >= 10000) {
    const fmt = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
    if (Math.abs(value) >= 100_000_000) {
      return `${sign}${fmt.format(Math.round(value / 100_000_000))}억`;
    }
    if (Math.abs(value) >= 10000) {
      return `${sign}${fmt.format(Math.round(value / 10000))}만`;
    }
  }
  return `${sign}₩${new Intl.NumberFormat("ko-KR").format(Math.round(value))}`;
}

export function formatPercent(value: number | null, fractionDigits = 2): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(fractionDigits)}%`;
}

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  general: "일반 위탁",
  isa_brokerage: "ISA 중개형",
  irp: "퇴직연금 (IRP)",
  pension: "개인연금",
};

export function pnlColorClass(value: number): string {
  if (value > 0) return "text-red-600 dark:text-red-400";
  if (value < 0) return "text-blue-600 dark:text-blue-400";
  return "text-muted-foreground";
}

const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /나스닥|S&P|미국|S&P|NASDAQ/i, category: "미국주식" },
  { pattern: /AI|반도체|테크|빅테크/i, category: "AI/반도체" },
  { pattern: /테슬라|TSLA/i, category: "테슬라" },
  { pattern: /채권|미국채|국채|크레딧/i, category: "채권" },
  { pattern: /리츠|REIT/i, category: "리츠" },
  { pattern: /금|GOLD/i, category: "금/원자재" },
  { pattern: /배당/i, category: "배당주" },
  { pattern: /KOSPI200|코스피200/i, category: "한국주식" },
];

export function inferCategory(name: string): string {
  for (const { pattern, category } of CATEGORY_RULES) {
    if (pattern.test(name)) return category;
  }
  return "기타";
}

// Shared color palette for portfolio charts (donut/pie/bar)
// Order: blue, green, orange, purple, cyan, yellow, pink, slate
export const CHART_COLORS = [
  "#2563eb",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#eab308",
  "#ec4899",
  "#64748b",
] as const;

/**
 * KST-safe date parser. CLAUDE.md 라인 319: `new Date("YYYY-MM-DD")`는 UTC로
 * 파싱돼 한국 기준 하루 어긋남이 발생. 항상 local-midnight로 파싱한다.
 */
export function parseKstDate(ymd: string): Date {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  return new Date(y, m - 1, d);
}

function todayKstYmd(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

export interface InflationAdjustedResult {
  years: number;
  inflated: number;
  realGain: number;
  realGainRate: number | null;
  outperformedInflation: boolean;
}

export function computeInflationAdjusted(params: {
  startPurchase: number;
  startDate: string;
  currentTotal: number;
  inflationRate: number;
  endDate?: string;
}): InflationAdjustedResult {
  const startMs = parseKstDate(params.startDate).getTime();
  const endMs = parseKstDate(params.endDate ?? todayKstYmd()).getTime();
  const years = Math.max(0, (endMs - startMs) / (365.25 * 86_400_000));
  const inflated = params.startPurchase * (1 + params.inflationRate) ** years;
  const realGain = params.currentTotal - inflated;
  const realGainRate = inflated > 0 ? (realGain / inflated) * 100 : null;
  return {
    years,
    inflated,
    realGain,
    realGainRate,
    outperformedInflation: realGain > 0,
  };
}

export interface RebalanceInputPosition {
  ticker: string;
  name: string;
  quantity: number;
  currentPrice: number;
  evalAmount: number;
}

export interface RebalanceInputTarget {
  ticker: string;
  name: string;
  targetWeight: number; // 0~1
}

export interface RebalanceInput {
  positions: RebalanceInputPosition[];
  targets: RebalanceInputTarget[];
  cashToInvest: number;
}

export type RebalanceStatus = "buy" | "hold" | "missing-price";

export interface RebalanceRow {
  ticker: string;
  name: string;
  currentWeight: number;
  targetWeight: number;
  afterWeight: number;
  currentEval: number;
  targetEval: number;
  diffAmount: number;
  buyAmount: number; // 분배된 예산 (실제 floor 전)
  buyShares: number;
  actualBuyAmount: number;
  currentPrice: number;
  status: RebalanceStatus;
}

export interface RebalanceResult {
  rows: RebalanceRow[];
  totalCurrent: number;
  totalAfter: number;
  totalActualBuy: number;
  remainingCash: number;
  warnings: string[];
  avgDriftBefore: number; // 평균 절대 편차 (0~1)
  avgDriftAfter: number;
}

/**
 * 매수 only 리밸런싱.
 *
 * 알고리즘:
 * 1. 각 종목의 "이상적 매수액(deficit)" 계산: max(0, totalAfter * targetWeight - currentEval)
 *    여기서 totalAfter = totalCurrent + cashToInvest (가상 균형 시점 자산)
 * 2. sumDeficit > cash 이면 부족분 비율로 cash를 비례 분배 (scale = cash / sumDeficit)
 *    sumDeficit <= cash 면 그대로 (scale = 1, 잔여 발생)
 * 3. 각 종목 floor(budget / currentPrice) = 실제 매수 주식
 * 4. 매수 후 비중 = (currentEval + actualBuyAmount) / actualTotalAfter
 */
export function computeRebalance(input: RebalanceInput): RebalanceResult {
  const totalCurrent = input.positions.reduce((s, p) => s + p.evalAmount, 0);
  const cash = Math.max(0, input.cashToInvest);
  const totalAfter = totalCurrent + cash;

  const posMap = new Map(input.positions.map((p) => [p.ticker, p]));
  const tgtMap = new Map(input.targets.map((t) => [t.ticker, t]));
  const tickers = new Set<string>([...posMap.keys(), ...tgtMap.keys()]);

  const warnings: string[] = [];

  interface Working {
    ticker: string;
    name: string;
    currentEval: number;
    targetWeight: number;
    targetEval: number;
    deficit: number;
    currentPrice: number;
    budget: number;
    buyShares: number;
    actualBuyAmount: number;
    status: RebalanceStatus;
  }

  const working: Working[] = [];
  for (const ticker of tickers) {
    const pos = posMap.get(ticker);
    const tgt = tgtMap.get(ticker);
    const currentEval = pos?.evalAmount ?? 0;
    const targetWeight = tgt?.targetWeight ?? 0;
    const targetEval = totalAfter * targetWeight;
    const deficit = Math.max(0, targetEval - currentEval);
    working.push({
      ticker,
      name: pos?.name ?? tgt?.name ?? ticker,
      currentEval,
      targetWeight,
      targetEval,
      deficit,
      currentPrice: pos?.currentPrice ?? 0,
      budget: 0,
      buyShares: 0,
      actualBuyAmount: 0,
      status: "hold",
    });
  }

  const sumDeficit = working.reduce((s, w) => s + w.deficit, 0);
  const scale = sumDeficit > 0 ? Math.min(1, cash / sumDeficit) : 0;

  for (const w of working) {
    w.budget = w.deficit * scale;
    if (w.currentPrice > 0) {
      w.buyShares = Math.floor(w.budget / w.currentPrice);
      w.actualBuyAmount = w.buyShares * w.currentPrice;
      w.status = w.buyShares > 0 ? "buy" : "hold";
    } else if (w.deficit > 0 && cash > 0) {
      w.status = "missing-price";
      warnings.push(`${w.name} (${w.ticker}): 현재가 정보가 없어 매수 수량 계산 불가`);
    }
  }

  const totalActualBuy = working.reduce((s, w) => s + w.actualBuyAmount, 0);
  const actualTotalAfter = totalCurrent + totalActualBuy;

  const rows: RebalanceRow[] = working.map((w) => {
    const newEval = w.currentEval + w.actualBuyAmount;
    return {
      ticker: w.ticker,
      name: w.name,
      currentWeight: totalCurrent > 0 ? w.currentEval / totalCurrent : 0,
      targetWeight: w.targetWeight,
      afterWeight: actualTotalAfter > 0 ? newEval / actualTotalAfter : 0,
      currentEval: w.currentEval,
      targetEval: w.targetEval,
      diffAmount: w.targetEval - w.currentEval,
      buyAmount: w.budget,
      buyShares: w.buyShares,
      actualBuyAmount: w.actualBuyAmount,
      currentPrice: w.currentPrice,
      status: w.status,
    };
  });

  rows.sort((a, b) => b.targetWeight - a.targetWeight);

  const avgDriftBefore =
    rows.length > 0
      ? rows.reduce((s, r) => s + Math.abs(r.currentWeight - r.targetWeight), 0) / rows.length
      : 0;
  const avgDriftAfter =
    rows.length > 0
      ? rows.reduce((s, r) => s + Math.abs(r.afterWeight - r.targetWeight), 0) / rows.length
      : 0;

  return {
    rows,
    totalCurrent,
    totalAfter: actualTotalAfter,
    totalActualBuy,
    remainingCash: cash - totalActualBuy,
    warnings,
    avgDriftBefore,
    avgDriftAfter,
  };
}
